export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QueueAdapter {
  enqueue(type: string, payload: unknown): Job;
  listJobs(): Job[];
  /** Deterministically advances every queued job by one step. No real timers. */
  tick(): void;
}
