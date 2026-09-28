"use client";
import { useActionState } from "react";
import type { PlayerListItem } from "@/modules/accounts";
import { MoneyForm } from "./money-form";
import { ResetForm } from "./reset-form";
import { Alert, SubmitButton } from "@/ui/form";
import { playerAction, type PlayerActionState } from "./actions";

const initialState: PlayerActionState = { message: null, tone: "success", temporaryPassword: null };

/** One player in the admin list, with a button for each thing an admin can change. */
type PlayerRowProps = {
  player: PlayerListItem;
  isYou: boolean;
  money: { balance: string; spent: string; selfFunded: string };
};

export function PlayerRow(props: PlayerRowProps) {
  const { player, isYou, money } = props;
  const [state, formAction] = useActionState(playerAction, initialState);
  const shared = { formAction, userId: player.userId }; // passed to every ActionButton

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{player.displayName}</span>
        <span className="text-sm text-zinc-500">@{player.username}</span>
        {isYou && <span className="text-xs text-zinc-500">(you)</span>}
        {player.isAdmin && <Badge>admin</Badge>}
        {player.canSelfFund && <Badge>self-funding</Badge>}
        {player.isDisabled && <Badge tone="danger">disabled</Badge>}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <MoneyFigure label="Balance" value={money.balance} />
        <MoneyFigure label="Spent" value={money.spent} />
        <MoneyFigure label="Self-funded" value={money.selfFunded} />
      </dl>
      <MoneyForm userId={player.userId} username={player.username} />

      <div className="flex flex-wrap gap-2">
        {player.isAdmin ? (
          <ActionButton {...shared} intent="demote" label="Remove admin" />
        ) : (
          <ActionButton {...shared} intent="promote" label="Make admin" />
        )}
        {player.canSelfFund ? (
          <ActionButton {...shared} intent="stop-self-funding" label="Stop self-funding" />
        ) : (
          <ActionButton {...shared} intent="allow-self-funding" label="Allow self-funding" />
        )}
        <ActionButton {...shared} intent="reset-password" label="Reset password" />
        {!isYou &&
          (player.isDisabled ? (
            <ActionButton {...shared} intent="enable" label="Enable" />
          ) : (
            <ActionButton {...shared} intent="disable" label="Disable" danger />
          ))}
      </div>

      <ResetForm userId={player.userId} username={player.username} />

      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
      {state.temporaryPassword && (
        <Alert tone="success">
          Temporary password for @{player.username}: <code>{state.temporaryPassword}</code>. Pass it
          on privately; it won&apos;t be shown again. They must change it when they sign in.
        </Alert>
      )}
    </li>
  );
}

type ActionButtonProps = {
  formAction: (formData: FormData) => void;
  userId: string;
  intent: string;
  label: string;
  danger?: boolean;
};

/** Every button submits the same action; the hidden `intent` field says which change to make. */
function ActionButton(props: ActionButtonProps) {
  return (
    <form action={props.formAction}>
      <input type="hidden" name="userId" value={props.userId} />
      <input type="hidden" name="intent" value={props.intent} />
      <SubmitButton tone={props.danger ? "danger" : "secondary"} pendingText="…">
        {props.label}
      </SubmitButton>
    </form>
  );
}

function MoneyFigure(props: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-zinc-500">{props.label}</dt>
      <dd className="font-medium tabular-nums">{props.value}</dd>
    </div>
  );
}

function Badge(props: { children: React.ReactNode; tone?: "danger" }) {
  const colors =
    props.tone === "danger"
      ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100"
      : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100";
  return <span className={`rounded px-2 py-0.5 text-xs ${colors}`}>{props.children}</span>;
}
