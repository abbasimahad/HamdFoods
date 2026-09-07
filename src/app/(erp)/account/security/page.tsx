import {
  ChangePasswordForm,
  DisplayNameForm,
  LoginEmailForm,
} from "@/components/auth/account-security-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requireUser } from "@/server/auth/server-guards";
import { serverEnv } from "@/server/server-env";

export default async function AccountSecurityPage() {
  const principal = await requireUser();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Account Security"
        description="Manage your profile and login credentials. Credential changes revoke existing sessions."
      />
      {serverEnv.AUTH_BYPASS_ENABLED && (
        <Card className="mb-5 p-5 text-sm">
          Development authentication bypass is active. Disable it and sign in normally to change
          account credentials.
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">Profile</h2>
          <DisplayNameForm currentName={principal.name} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">Login</h2>
          <LoginEmailForm currentEmail={principal.email} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">Password</h2>
          <ChangePasswordForm />
        </Card>
      </div>
    </ResponsiveContainer>
  );
}
