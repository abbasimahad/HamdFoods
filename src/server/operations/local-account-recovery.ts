export function isAdministratorHighIntegrity(groupOutput: string): boolean {
  return (
    /(?:^|\s)S-1-5-32-544(?:\s|$)/m.test(groupOutput) &&
    /(?:^|\s)S-1-16-(?:12288|16384)(?:\s|$)/m.test(groupOutput)
  );
}
