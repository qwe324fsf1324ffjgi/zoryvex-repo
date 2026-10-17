import type { Job, JobStatus, QueueAdapter } from '../interfaces/queue';
import { getJSON, setJSON } from './storage';

const KEY = 'QUEUE#JOBS';

function nextStatus(status: JobStatus): JobStatus {
  if (status === 'queued') return 'processing';
  if (status === 'processing') return 'done';
  return status;
}

export class LocalQueueAdapter implements QueueAdapter {
  enqueue(type: string, payload: unknown): Job {
    const job: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const jobs = getJSON<Job[]>(KEY) ?? [];
    jobs.push(job);
    setJSON(KEY, jobs);
    return job;
  }

  listJobs(): Job[] {
    return getJSON<Job[]>(KEY) ?? [];
  }

  tick(): void {
    const jobs = getJSON<Job[]>(KEY) ?? [];
    const advanced = jobs.map((job) =>
      job.status === 'done' || job.status === 'failed'
        ? job
        : { ...job, status: nextStatus(job.status), updatedAt: new Date().toISOString() },
    );
    setJSON(KEY, advanced);
  }
}
