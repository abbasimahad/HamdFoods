export function createAuthOptions(input: { allowSignUp?: boolean } = {}) {
  return {
    emailAndPassword: {
      enabled: true,
      disableSignUp: !input.allowSignUp,
      autoSignIn: !input.allowSignUp,
    },
    user: {
      additionalFields: {
        active: { type: "boolean" as const, required: true, defaultValue: true, input: false },
      },
    },
  };
}
