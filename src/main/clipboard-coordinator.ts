/** Serialize Voca's selection/paste transactions, including delayed restoration. */
export class ClipboardCoordinator {
  private pending: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
}

export const clipboardCoordinator = new ClipboardCoordinator()
