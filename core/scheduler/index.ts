export class WeeklyScheduler {
  describeWindow(referenceDate = new Date()): { label: string; nextRun: string } {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate);
    start.setDate(start.getDate() - 7);

    const label = `${start.toISOString().slice(0, 10)} -> ${end.toISOString().slice(0, 10)}`;
    const nextRun = new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    return { label, nextRun };
  }
}
