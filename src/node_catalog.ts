export type BtNodeKind = "control" | "decorator" | "condition" | "action" | "unknown";

export const CONTROL_NODES = new Set([
  "Sequence",
  "Fallback",
  "ReactiveSequence",
  "ReactiveFallback",
  "Parallel",
  "BehaviorTree"
]);

export const DECORATOR_NODES = new Set([
  "Inverter",
  "RetryUntilSuccessful",
  "Repeat",
  "Timeout",
  "ForceSuccess",
  "ForceFailure"
]);

export const CONDITION_NODES = new Set([
  "GoalUpdated",
  "GoalReached",
  "IsPathValid"
]);

export function getBuiltinNodeKind(tag: string): BtNodeKind {
  if (CONTROL_NODES.has(tag)) {
    return "control";
  }

  if (DECORATOR_NODES.has(tag)) {
    return "decorator";
  }

  if (CONDITION_NODES.has(tag)) {
    return "condition";
  }

  return "action";
}