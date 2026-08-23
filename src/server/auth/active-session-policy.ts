export function createActiveSessionBeforeHook(loadActive: (userId: string) => Promise<boolean>) {
  return async <Session extends { userId: string }>(session: Session) => {
    if (!(await loadActive(session.userId))) return false;
    return { data: session };
  };
}
