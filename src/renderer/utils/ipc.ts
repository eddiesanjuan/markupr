/**
 * Shared IPC response type and type guard for renderer-side IPC communication.
 *
 * All IPC handlers in the main process return { success, data?, error? }.
 * Use isIPCResponse() to validate responses before accessing fields.
 */

export interface IPCResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Type guard to validate IPC response structure.
 * Returns true if the value is a non-null object with a boolean `success` field.
 */
export function isIPCResponse<T>(value: unknown): value is IPCResponse<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as IPCResponse).success === "boolean"
  )
}
