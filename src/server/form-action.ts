import { z } from "zod";
import type { Actor, AdminActor } from "@/modules/accounts";
import type { Result } from "@/shared/kernel";
import type { ActionContext } from "./action";
import type { Capabilities } from "./capabilities";
import type { Reads } from "./reads";

// `formAction(schema, handler)`: `action()`'s twin for a `<form>` (design doc 67, section 9). It
// reads the FormData with the schema's help, checks the session the way `action()` does, parses,
// and turns a `Result` error into the form's message through the module's `describeError`. The
// handler never touches FormData.

/** What a form shows after it was sent. Every form uses this one shape. */
export type FormState = Readonly<
  { message: null; tone: null } | { message: string; tone: "error" | "success" }
>;

export type AdminActionContext = Readonly<{
  actor: AdminActor;
  capabilities: Capabilities;
  reads: Reads;
}>;

export type FormActionSources = Readonly<{
  /** The signed-in player (sends visitors who aren't signed in to the sign-in page). */
  requireActor(): Promise<Actor>;
  /** The signed-in admin; anyone else sees "not found". */
  requireAdminActor(): Promise<AdminActor>;
  capabilities(): Capabilities;
  reads(): Reads;
  /** Next's `redirect`: it throws, so nothing after it runs. */
  redirect(path: string): never;
}>;

export type FormActionOptions<Value, Failure> = Readonly<{
  /** The sentence for each expected failure the handler returns. */
  describeError(error: Failure): string;
  /** What the form says when the schema rejects the input, instead of listing the issues. */
  invalidInput?: string;
  /** Shown after success. Leave out for a form that redirects or shows nothing. */
  successMessage?: string | ((value: Value) => string);
  /** Where to go after success, instead of showing a message. */
  redirectTo?: string | ((value: Value) => string);
}>;

/**
 * What the form calls: with the form's data last, and the form's previous state first when it is
 * used with `useActionState`.
 */
export type FormRunner = {
  (formData: FormData): Promise<FormState>;
  (previous: FormState, formData: FormData): Promise<FormState>;
};

/** An unchecked box is absent from the FormData and a checked one is "on": `false` or `true`. */
export function checkbox() {
  return z.preprocess((value) => value === "on", z.boolean());
}

/** A blank text field means "none": `""` becomes `undefined` before `schema` sees it. */
export function blankAsUndefined<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

/** Whether a field holds a list (so it is read with `getAll`), looking through optional, default, ... */
function holdsList(schema: z.ZodType): boolean {
  const definition = schema._zod.def as {
    type: string;
    innerType?: z.ZodType;
    out?: z.ZodType;
  };
  if (definition.type === "array") return true;
  if (definition.innerType !== undefined) return holdsList(definition.innerType);
  if (definition.type === "pipe" && definition.out !== undefined) return holdsList(definition.out);
  return false;
}

/** The form's fields as the schema expects them: a list field gets every value, others the first. */
function readForm(schema: z.ZodObject, formData: FormData): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    fields[key] = holdsList(fieldSchema) ? formData.getAll(key) : (formData.get(key) ?? undefined);
  }
  return fields;
}

/** The problems, as one sentence: the same text `action()` builds for its input errors. */
function problemsAsText(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}

/** Builds `formAction` from where the actor, the capabilities and `redirect` come from (fakes in tests). */
export function makeFormAction(sources: FormActionSources) {
  // The admin form first: only an options object that says `admin: true` fits it.
  function formAction<Schema extends z.ZodObject, Value, Failure>(
    schema: Schema,
    handler: (
      context: AdminActionContext,
      input: z.output<Schema>,
    ) => Promise<Result<Value, Failure>>,
    options: FormActionOptions<Value, Failure> & Readonly<{ admin: true }>,
  ): FormRunner;
  function formAction<Schema extends z.ZodObject, Value, Failure>(
    schema: Schema,
    handler: (context: ActionContext, input: z.output<Schema>) => Promise<Result<Value, Failure>>,
    options: FormActionOptions<Value, Failure>,
  ): FormRunner;
  function formAction<Schema extends z.ZodObject, Value, Failure>(
    schema: Schema,
    handler: (
      context: ActionContext & AdminActionContext,
      input: z.output<Schema>,
    ) => Promise<Result<Value, Failure>>,
    options: FormActionOptions<Value, Failure> & Readonly<{ admin?: true }>,
  ): FormRunner {
    async function run(...given: [FormData] | [FormState, FormData]): Promise<FormState> {
      const formData = given[given.length - 1] as FormData;
      const actor = options.admin
        ? await sources.requireAdminActor()
        : await sources.requireActor();
      const parsed = schema.safeParse(readForm(schema, formData));
      if (!parsed.success) {
        return { message: options.invalidInput ?? problemsAsText(parsed.error), tone: "error" };
      }

      // `actor` is an AdminActor exactly when `options.admin` is set, which the overloads tie to the handler.
      const context = { actor, capabilities: sources.capabilities(), reads: sources.reads() };
      const result = await handler(context as ActionContext & AdminActionContext, parsed.data);
      if (!result.ok) return { message: options.describeError(result.error), tone: "error" };

      const destination =
        typeof options.redirectTo === "function"
          ? options.redirectTo(result.value)
          : options.redirectTo;
      if (destination !== undefined) sources.redirect(destination);

      const text =
        typeof options.successMessage === "function"
          ? options.successMessage(result.value)
          : options.successMessage;
      return text === undefined
        ? { message: null, tone: null }
        : { message: text, tone: "success" };
    }
    return run as FormRunner;
  }
  return formAction;
}
