import { CloudTasksClient } from '@google-cloud/tasks';
import type { MarketPlan } from '@mi/research';
import type { ServiceEnv } from '../env';
import type { TraceContext } from './observability';

export interface TaskPayload {
  deckId: string;
  userId: string;
  plan: MarketPlan;
  query: string;
  maxCandidates?: number;
  watch?: boolean;
  traceContext?: TraceContext | null;
}

export interface RefreshTaskPayload {
  deckId: string;
  userId: string;
  query: string;
  traceContext?: TraceContext | null;
}

export interface TasksAdapter {
  enqueueDeckCreation(payload: TaskPayload): Promise<void>;
  enqueueDeckRefresh(payload: RefreshTaskPayload): Promise<void>;
}

export class CloudTasksAdapter implements TasksAdapter {
  private client: CloudTasksClient;
  private config: NonNullable<ServiceEnv['tasks']>;

  constructor(env: ServiceEnv, client?: CloudTasksClient) {
    if (!env.tasks) {
      throw new Error('Cloud Tasks is not configured in this environment');
    }
    this.config = env.tasks;
    this.client = client ?? new CloudTasksClient();
  }

  async enqueueDeckCreation(payload: TaskPayload): Promise<void> {
    const parent = this.client.queuePath(this.config.projectId, this.config.location, this.config.queue);
    
    // We use the deckId as part of the task ID to ensure idempotency.
    // If the same task is queued twice, Cloud Tasks will deduplicate based on the name.
    const taskId = `deck-create-${payload.deckId}`;
    const taskName = `${parent}/tasks/${taskId}`;

    const task = {
      name: taskName,
      httpRequest: {
        httpMethod: 'POST' as const,
        url: this.config.workerUrl,
        oidcToken: {
          serviceAccountEmail: this.config.serviceAccountEmail,
        },
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
    };

    try {
      await this.client.createTask({ parent, task });
    } catch (e: unknown) {
      const err = e as Error & { code?: string | number };
      // 409 means ALREADY_EXISTS. This is expected due to our idempotent task name.
      if (err.code !== 6 && err.code !== 'ALREADY_EXISTS') {
        throw err;
      }
    }
  }

  async enqueueDeckRefresh(payload: RefreshTaskPayload): Promise<void> {
    const parent = this.client.queuePath(this.config.projectId, this.config.location, this.config.queue);
    
    // Idempotent task naming for refreshes based on deckId and time slice (e.g. daily/weekly)
    // To make it simple for now, we just use a timestamp for idempotency within a window
    // Or we could let the task id be generated if we don't care about strict de-dupe at scheduler level.
    // Cloud Tasks requires task name to not exist in queue or recently completed.
    const taskId = `deck-refresh-${payload.deckId}-${Math.floor(Date.now() / 86400000)}`;
    const taskName = `${parent}/tasks/${taskId}`;

    const refreshWorkerUrl = this.config.workerUrl.replace('/research', '/refresh');

    const task = {
      name: taskName,
      httpRequest: {
        httpMethod: 'POST' as const,
        url: refreshWorkerUrl,
        oidcToken: {
          serviceAccountEmail: this.config.serviceAccountEmail,
        },
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
    };

    try {
      await this.client.createTask({ parent, task });
    } catch (e: unknown) {
      const err = e as Error & { code?: string | number };
      if (err.code !== 6 && err.code !== 'ALREADY_EXISTS') {
        throw err;
      }
    }
  }
}

export class MockTasksAdapter implements TasksAdapter {
  public queuedTasks: TaskPayload[] = [];
  public queuedRefreshes: RefreshTaskPayload[] = [];

  constructor(private readonly localPort?: number) {}
  
  async enqueueDeckCreation(payload: TaskPayload): Promise<void> {
    this.queuedTasks.push(payload);
    if (this.localPort) {
      // Simulate Cloud Tasks by calling the worker endpoint asynchronously
      setTimeout(() => {
        fetch(`http://127.0.0.1:${this.localPort}/tasks/worker/research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(e => console.error('Local worker simulation failed:', e));
      }, 500);
    }
  }

  async enqueueDeckRefresh(payload: RefreshTaskPayload): Promise<void> {
    this.queuedRefreshes.push(payload);
    if (this.localPort) {
      setTimeout(() => {
        fetch(`http://127.0.0.1:${this.localPort}/tasks/worker/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(e => console.error('Local refresh worker simulation failed:', e));
      }, 500);
    }
  }
}
