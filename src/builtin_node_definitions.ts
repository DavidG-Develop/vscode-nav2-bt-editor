import {
  BtNodeKind,
  TreeNodeDefinition,
  TreeNodeDefinitionSource,
  TreeNodePort
} from "./bt_parser";

type BuiltinNodeEntry = {
  id: string;
  kind: BtNodeKind;
  ports: TreeNodePort[];
};

export const BUILTIN_NODE_DEFINITIONS: TreeNodeDefinition[] = [
  ...makeBuiltinDefinitions("control", [
    node("BehaviorTree", ports("ID")),

    node("Sequence"),
    node("AsyncSequence"),
    node("SequenceStar"),
    node("SequenceWithMemory"),
    node("ReactiveSequence"),
    node("Fallback"),
    node("AsyncFallback"),
    node("Selector"),
    node("ReactiveFallback"),
    node("Parallel"),
    node("ParallelAll"),
    node("IfThenElse"),
    node("WhileDoElse"),
    node("Switch2"),
    node("Switch3"),
    node("Switch4"),
    node("Switch5"),
    node("Switch6"),

    node("PipelineSequence"),
    node("RecoveryNode", ports("number_of_retries")),
    node("RoundRobin"),
    node("NonblockingSequence"),
    node("PersistentSequence"),
    node("PauseResumeController")
  ]),

  ...makeBuiltinDefinitions("decorator", [
    node("Inverter"),
    node("ForceSuccess"),
    node("ForceFailure"),
    node("Repeat", ports("num_cycles")),
    node("RetryUntilSuccessful", ports("num_attempts")),
    node("RetryUntilSuccesful", ports("num_attempts")),
    node("KeepRunningUntilFailure"),
    node("Delay", ports("delay_msec")),
    node("Timeout", ports("msec")),
    node("RunOnce", ports("then_skip")),
    node("Precondition"),

    node("SubTree", ports("ID", "_autoremap")),
    node("SubTreePlus", ports("ID", "_autoremap")),

    node("RateController", ports("hz")),
    node("DistanceController", ports("distance")),
    node("SpeedController", ports("min_speed", "max_speed")),
    node("GoalUpdater", ports("input_goal", "output_goal")),
    node("GoalUpdatedController", ports("goal")),
    node("SingleTrigger"),
    node("PathLongerOnApproach", ports("path", "prox_len", "length_factor"))
  ]),

  ...makeBuiltinDefinitions("condition", [
    node("AlwaysSuccess"),
    node("AlwaysFailure"),
    node("ScriptCondition", ports("code")),

    node("AreErrorCodesPresent", ports("error_code", "error_codes")),
    node("ArePosesNear", ports("pose1", "pose2", "tolerance")),
    node("DistanceTraveled", ports("distance")),
    node("GloballyUpdatedGoal", ports("goal")),
    node(
      "GoalReached",
      ports("goal", "global_frame", "robot_base_frame", "xy_goal_tolerance")
    ),
    node("GoalUpdated", ports("goal")),
    node("InitialPoseReceived"),
    node("IsBatteryCharging", ports("battery_topic")),
    node("IsBatteryLow", ports("battery_topic", "min_battery", "is_voltage")),
    node("IsGoalNearby", ports("goal", "distance")),
    node("IsPathValid", ports("path")),
    node("IsStuck"),
    node(
      "IsWithinPathTrackingBounds",
      ports("path", "robot_base_frame", "transform_tolerance")
    ),
    node("PathExpiringTimer", ports("seconds", "path")),
    node("TimeExpired", ports("seconds")),
    node("TransformAvailable", ports("child", "parent")),
    node("WouldAControllerRecoveryHelp", ports("error_code")),
    node("WouldAPlannerRecoveryHelp", ports("error_code")),
    node("WouldARouteRecoveryHelp", ports("error_code")),
    node("WouldASmootherRecoveryHelp", ports("error_code"))
  ]),

  ...makeBuiltinDefinitions("action", [
    node("SetBlackboard", ports("output_key", "value")),
    node("UnsetBlackboard", ports("key")),
    node("Script", ports("code")),
    node("Sleep", ports("msec")),

    node("AppendGoalPoseToGoals", ports("goal", "goals")),
    node("AssistedTeleop", ports("time_allowance", "is_recovery")),
    node("CancelAssistedTeleop", ports("service_name")),
    node("AssistedTeleopCancel", ports("service_name")),
    node("BackUp", ports("backup_dist", "backup_speed", "time_allowance", "is_recovery")),
    node("CancelBackUp", ports("service_name")),
    node("BackUpCancel", ports("service_name")),
    node("ClearEntireCostmap", ports("service_name")),
    node("ClearCostmapAroundRobot", ports("service_name", "reset_distance")),
    node("ClearCostmapExceptRegion", ports("service_name", "reset_distance")),
    node("ComputeAndTrackRoute", ports("goal", "path", "route", "server_name")),
    node("CancelComputeAndTrackRoute", ports("service_name")),
    node("ComputeAndTrackRouteCancel", ports("service_name")),
    node("ComputePathThroughPoses", ports("goals", "path", "planner_id", "server_name")),
    node("ComputePathToPose", ports("goal", "path", "planner_id", "server_name")),
    node("ComputeRoute", ports("goal", "route", "path", "server_name")),
    node("ConcatenatePaths", ports("input_path1", "input_path2", "output_path")),
    node("CancelControl", ports("service_name")),
    node("ControllerCancel", ports("service_name")),
    node("ControllerSelector", ports("selected_controller", "default_controller", "topic_name")),
    node("DriveOnHeading", ports("dist_to_travel", "speed", "time_allowance", "is_recovery")),
    node("CancelDriveOnHeading", ports("service_name")),
    node("DriveOnHeadingCancel", ports("service_name")),
    node("ExtractRouteNodesAsGoals", ports("route", "goals")),
    node("FollowPath", ports("path", "controller_id", "goal_checker_id", "server_name")),
    node("FollowObject", ports("object_topic", "server_name")),
    node("GetCurrentPose", ports("global_frame", "robot_base_frame", "transform_tolerance", "current_pose")),
    node("GetNextFewGoals", ports("goals", "num_goals", "output_goals")),
    node("GetPoseFromPath", ports("path", "pose")),
    node("GoalCheckerSelector", ports("selected_goal_checker", "default_goal_checker", "topic_name")),
    node("NavigateThroughPoses", ports("goals", "behavior_tree", "server_name")),
    node("NavigateToPose", ports("goal", "behavior_tree", "server_name")),
    node("PlannerSelector", ports("selected_planner", "default_planner", "topic_name")),
    node("ProgressCheckerSelector", ports("selected_progress_checker", "default_progress_checker", "topic_name")),
    node("ReinitializeGlobalLocalization", ports("service_name")),
    node("RemoveInCollisionGoals", ports("goals", "costmap_topic", "footprint_topic", "output_goals")),
    node("RemovePassedGoals", ports("goals", "radius", "output_goals")),
    node("SmoothPath", ports("unsmoothed_path", "smoothed_path", "smoother_id", "server_name")),
    node("SmootherSelector", ports("selected_smoother", "default_smoother", "topic_name")),
    node("Spin", ports("spin_dist", "time_allowance", "is_recovery")),
    node("CancelSpin", ports("service_name")),
    node("SpinCancel", ports("service_name")),
    node("TruncatePath", ports("input_path", "output_path", "distance")),
    node("TruncatePathLocal", ports("input_path", "output_path", "distance", "forward")),
    node("Wait", ports("wait_duration", "is_recovery")),
    node("CancelWait", ports("service_name")),
    node("WaitCancel", ports("service_name"))
  ])
];

function makeBuiltinDefinitions(
  kind: BtNodeKind,
  entries: BuiltinNodeEntry[]
): TreeNodeDefinition[] {
  return entries.map((entry) => {
    return {
      id: entry.id,
      kind,
      source: "builtin" satisfies TreeNodeDefinitionSource,
      ports: withCommonPorts(entry.id, entry.ports)
    };
  });
}

function node(id: string, nodePorts: TreeNodePort[] = []): BuiltinNodeEntry {
  return {
    id,
    kind: "action",
    ports: nodePorts
  };
}

function ports(...names: string[]): TreeNodePort[] {
  return names.map((name) => {
    return {
      name,
      direction: "input"
    };
  });
}

function withCommonPorts(
  nodeId: string,
  nodePorts: TreeNodePort[]
): TreeNodePort[] {
  if (nodeId === "BehaviorTree") {
    return ensurePorts(nodePorts, ports("ID"));
  }

  if (nodeId === "SubTree" || nodeId === "SubTreePlus") {
    return ensurePorts(nodePorts, ports("ID", "_autoremap"));
  }

  return ensurePorts(nodePorts, ports("name"));
}

function ensurePorts(
  nodePorts: TreeNodePort[],
  requiredPorts: TreeNodePort[]
): TreeNodePort[] {
  const existingNames = new Set(nodePorts.map((port) => port.name));
  const missingPorts = requiredPorts.filter(
    (port) => !existingNames.has(port.name)
  );

  return [
    ...missingPorts,
    ...nodePorts
  ];
}