export interface RuntimeFailureDetails {
    readonly errorType: string;
    readonly errorCode?: string;
    readonly reason?: string;
    readonly source?: string;
}
export function runtimeFailureDetails(error: unknown): RuntimeFailureDetails;
