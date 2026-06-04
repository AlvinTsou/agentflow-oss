export type IssueStatus = "todo" | "in_progress" | "blocked" | "review" | "done";
export type WebLabel = "pm" | "design" | "spec" | "bug" | "question" | "change-request";
export type FeedbackType = "comment" | "change-request" | "approval" | "request-changes" | "force-pass";

export interface WebIssue {
  id: string;
  title: string;
  body: string;
  status: IssueStatus;
  labels: WebLabel[];
  linkedStep?: string;
  assignee?: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebFeedbackEvent {
  id: string;
  type: FeedbackType;
  sprintId: string;
  step?: string;
  /**
   * When set, the record targets ONE iter inside a forEach step (e.g. "T3" / "Q5").
   * Engine ingest filters per-iter: an iter sees feedback whose `iteration` is
   * unset (step-wide) or matches its own id. Unset = applies to every iter in the step.
   */
  iteration?: string;
  author: string;
  body: string;
  createdAt: string;
  linkedIssueId?: string;
  /**
   * Set when the record is no longer "open". Ingest filters out resolved items
   * from the engine's human_context block.
   */
  resolvedAt?: string;
}

export interface ArtifactEdit {
  id: string;
  targetStep: string;
  author: string;
  targetFile: string;
  baseHash: string;
  newHash: string;
  createdAt: string;
}
