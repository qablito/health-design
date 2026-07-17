import {
  RUNTIME_SMOKE_EXAMPLE,
  RuntimeSmokeSchema,
  type RuntimeSmokePayload,
} from "@health-design/contracts";

export function getWebRuntimeSmoke(): RuntimeSmokePayload {
  return RuntimeSmokeSchema.parse(RUNTIME_SMOKE_EXAMPLE);
}
