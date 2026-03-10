import path from "node:path";

import { readJsonSafe, writeJsonEnsured } from "../shared/fs-utils";
import type { AgentTask } from "../shared/types";

interface TaskBoardSnapshot {
  backlog: AgentTask[];
  active: AgentTask[];
  completed: AgentTask[];
}

function classify(tasks: AgentTask[]): TaskBoardSnapshot {
  return {
    backlog: tasks.filter((task) => task.state === "NEW"),
    active: tasks.filter((task) => task.state === "ANALYZING" || task.state === "PROPOSED"),
    completed: tasks.filter((task) => ["APPROVED", "REJECTED", "ARCHIVED"].includes(task.state))
  };
}

export class AgentTaskBoard {
  constructor(private readonly taskBoardDir: string) {}

  async initialize(): Promise<void> {
    const existingBacklog = await readJsonSafe<AgentTask[]>(path.join(this.taskBoardDir, "backlog.json"));

    if (!existingBacklog) {
      await this.persist([]);
    }
  }

  async loadAll(): Promise<AgentTask[]> {
    const backlog = (await readJsonSafe<AgentTask[]>(path.join(this.taskBoardDir, "backlog.json"))) ?? [];
    const active = (await readJsonSafe<AgentTask[]>(path.join(this.taskBoardDir, "active.json"))) ?? [];
    const completed = (await readJsonSafe<AgentTask[]>(path.join(this.taskBoardDir, "completed.json"))) ?? [];
    return [...backlog, ...active, ...completed];
  }

  async persist(tasks: AgentTask[]): Promise<void> {
    const grouped = classify(tasks);
    await writeJsonEnsured(path.join(this.taskBoardDir, "backlog.json"), grouped.backlog);
    await writeJsonEnsured(path.join(this.taskBoardDir, "active.json"), grouped.active);
    await writeJsonEnsured(path.join(this.taskBoardDir, "completed.json"), grouped.completed);
  }

  claim(tasks: AgentTask[], taskId: string): AgentTask[] {
    return tasks.map((task) =>
      task.taskId === taskId
        ? {
            ...task,
            state: "ANALYZING",
            claimedAt: new Date().toISOString()
          }
        : task
    );
  }

  update(tasks: AgentTask[], updatedTask: AgentTask): AgentTask[] {
    return tasks.map((task) => (task.taskId === updatedTask.taskId ? updatedTask : task));
  }
}
