import { getSystemHealth } from "@/modules/system/application/get-system-health";
import { probeDatabase } from "@/server/db/probe-database";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getSystemHealth(probeDatabase);

  if (health.database === "connected")
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );

  return Response.json(
    { status: "unavailable" },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );
}
