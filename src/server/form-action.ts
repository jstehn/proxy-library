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
  /**
   * The signed-in player (sends visitors who aren't signed in to the sign-in page, and players who
   * must change their password to that page, unless `allowPasswordChangePending`).
   */
  requireActor(options?: Readonly<{ allowPasswordChangePending?: boolean }>): Promise<Actor>;
  /** The signed-in admin; anyone else sees "not found". */
  requireAdminActor(): Promise<AdminActor>;
  capabilities(): Capabilities;
  reads(): Reads;
  /** Next's `redirect`: it throws, so nothing after it runs. */
  redirect(path: string): never;
}>;

/** What `formRedirect` and `formVoid` take, besides the schema and the handler. */
export type PlainFormOptions = Readonly<{
  /** Lets a player who must still change their password use the form (the change-password form). */
  allowPasswordChangePending?: boolean;
}>;

/** What a form with a state takes: the plain options plus how it words each outcome. */
export type FormActionOptions<Value, Failure> = PlainFormOptions &
  Readonly<{
    /** The sentence for each expected failure the handler returns. */
    describeError(error: Failure): string;
    /**
     * What the form says when the schema rejects the input, instead of listing the issues: one
     * sentence, or one chosen from the first problem (`messageByField`).
     */
    invalidInput?: string | ((error: z.ZodError) => string);
    /** Shown after success. Leave out for a form that redirects or shows nothing. */
    successMessage?: string | ((value: Value) => string);
    /** Where to go after success, instead of showing a message (`undefined`: stay and show it). */
    redirectTo?: string | ((value: Value) => string | undefined);
  }>;

/** The fields a form can read: an object, or a union of objects told apart by one field. */
export type FormSchema = z.ZodObject | z.ZodDiscriminatedUnion;

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

/** Every field the schema names; for a union, the fields of all its options. */
function fieldsOf(schema: FormSchema): Record<string, z.ZodType> {
  if ("shape" in schema) return schema.shape as Record<string, z.ZodType>;
  const fields: Record<string, z.ZodType> = {};
  for (const option of schema.options) Object.assign(fields, fieldsOf(option as z.ZodObject));
  return fields;
}

/** The form's fields as the schema expects them: a list field gets every value, others the first. */
function readForm(schema: FormSchema, formData: FormData): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(fieldsOf(schema))) {
    fields[key] = holdsList(fieldSchema) ? formData.getAll(key) : (formData.get(key) ?? undefined);
  }
  return fields;
}

/**
 * For a form that returns its own state, not a `FormState` (it keeps typed values, shows a secret
 * once, lists problems): reads the FormData the way `formAction` does, and gives the schema's
 * result. The action still finds the actor itself.
 */
export function parseForm<Schema extends FormSchema>(schema: Schema, formData: FormData) {
  return schema.safeParse(readForm(schema, formData)) as z.ZodSafeParseResult<z.output<Schema>>;
}

/**
 * A sentence per field, for `invalidInput`: the message of the first problem's field, or
 * `otherwise` when that field has none. (A schema lists its fields in order, so the order of the
 * form decides which problem comes first.)
 */
export function messageByField(messages: Readonly<Record<string, string>>, otherwise: string) {
  return function choose(error: z.ZodError): string {
    const field = String(error.issues[0]?.path[0] ?? "");
    return messages[field] ?? otherwise;
  };
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
  function formAction<Schema extends FormSchema, Value, Failure>(
    schema: Schema,
    handler: (
      context: AdminActionContext,
      input: z.output<Schema>,
    ) => Promise<Result<Value, Failure>>,
    options: FormActionOptions<Value, Failure> & Readonly<{ admin: true }>,
  ): FormRunner;
  function formAction<Schema extends FormSchema, Value, Failure>(
    schema: Schema,
    handler: (context: ActionContext, input: z.output<Schema>) => Promise<Result<Value, Failure>>,
    options: FormActionOptions<Value, Failure>,
  ): FormRunner;
  function formAction<Schema extends FormSchema, Value, Failure>(
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
        : await sources.requireActor({
            allowPasswordChangePending: options.allowPasswordChangePending,
          });
      const parsed = schema.safeParse(readForm(schema, formData));
      if (!parsed.success) {
        const { invalidInput } = options;
        const message =
          typeof invalidInput === "function"
            ? invalidInput(parsed.error)
            : (invalidInput ?? problemsAsText(parsed.error));
        return { message, tone: "error" };
      }

      // `actor` is an AdminActor exactly when `options.admin` is set, which the overloads tie to the handler.
      const context = { actor, capabilities: sources.capabilities(), reads: sources.reads() };
      const result = await handler(
        context as ActionContext & AdminActionContext,
        parsed.data as z.output<Schema>,
      );
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

/** What `formVoid` takes for an admin's form. */
type AdminOption = PlainFormOptions & Readonly<{ admin: true }>;

/** The signed-in player, or the admin when the form says `admin: true`. */
async function actorFor(
  sources: FormActionSources,
  options: PlainFormOptions & Readonly<{ admin?: true }>,
): Promise<Actor> {
  if (options.admin) return sources.requireAdminActor();
  return sources.requireActor({ allowPasswordChangePending: options.allowPasswordChangePending });
}

/**
 * `formRedirect(schema, handler, options)`: for a plain `<form action>` that goes somewhere after
 * it is sent (back to its page with `?error=` or `?message=`, or on to the next page). The
 * handler returns the path to go to, or `undefined` to stay where it is. A form the schema can't read (one changed by hand) throws, unless
 * `unreadable` names a path to go to instead.
 */
export function makeFormRedirect(sources: FormActionSources) {
  type RedirectOptions = PlainFormOptions & Readonly<{ unreadable?: string }>;
  function formRedirect<Schema extends FormSchema>(
    schema: Schema,
    handler: (context: AdminActionContext, input: z.output<Schema>) => Promise<string | undefined>,
    options: RedirectOptions & Readonly<{ admin: true }>,
  ): (formData: FormData) => Promise<void>;
  function formRedirect<Schema extends FormSchema>(
    schema: Schema,
    handler: (context: ActionContext, input: z.output<Schema>) => Promise<string | undefined>,
    options?: RedirectOptions,
  ): (formData: FormData) => Promise<void>;
  function formRedirect<Schema extends FormSchema>(
    schema: Schema,
    handler: (
      context: ActionContext & AdminActionContext,
      input: z.output<Schema>,
    ) => Promise<string | undefined>,
    options: RedirectOptions & Readonly<{ admin?: true }> = {},
  ): (formData: FormData) => Promise<void> {
    async function run(formData: FormData): Promise<void> {
      const actor = await actorFor(sources, options);
      const parsed = schema.safeParse(readForm(schema, formData));
      if (!parsed.success) {
        if (options.unreadable !== undefined) sources.redirect(options.unreadable);
        throw new Error(`The form could not be read. ${problemsAsText(parsed.error)}`);
      }
      const context = { actor, capabilities: sources.capabilities(), reads: sources.reads() };
      const input = parsed.data as z.output<Schema>;
      const destination = await handler(context as ActionContext & AdminActionContext, input);
      if (destination !== undefined) sources.redirect(destination);
    }
    return run;
  }
  return formRedirect;
}

/**
 * `formVoid(schema, handler, options)`: for a plain `<form action>` that shows nothing after it
 * is sent (the row just changes). A form the schema can't read does nothing.
 */
export function makeFormVoid(sources: FormActionSources) {
  function formVoid<Schema extends FormSchema>(
    schema: Schema,
    handler: (context: AdminActionContext, input: z.output<Schema>) => Promise<unknown>,
    options: AdminOption,
  ): (formData: FormData) => Promise<void>;
  function formVoid<Schema extends FormSchema>(
    schema: Schema,
    handler: (context: ActionContext, input: z.output<Schema>) => Promise<unknown>,
    options?: PlainFormOptions,
  ): (formData: FormData) => Promise<void>;
  function formVoid<Schema extends FormSchema>(
    schema: Schema,
    handler: (
      context: ActionContext & AdminActionContext,
      input: z.output<Schema>,
    ) => Promise<unknown>,
    options: PlainFormOptions & Readonly<{ admin?: true }> = {},
  ): (formData: FormData) => Promise<void> {
    async function run(formData: FormData): Promise<void> {
      const actor = await actorFor(sources, options);
      const parsed = schema.safeParse(readForm(schema, formData));
      if (!parsed.success) return;
      const context = { actor, capabilities: sources.capabilities(), reads: sources.reads() };
      await handler(context as ActionContext & AdminActionContext, parsed.data as z.output<Schema>);
    }
    return run;
  }
  return formVoid;
}
