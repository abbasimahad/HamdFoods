export interface SystemHealth {
  application: "operational";
  configuration: "valid";
  database: "connected" | "unavailable";
}

export async function getSystemHealth(checkDatabase: () => Promise<void>): Promise<SystemHealth> {
  let database: SystemHealth["database"] = "connected";

  try {
    await checkDatabase();
  } catch {
    database = "unavailable";
  }

  return {
    application: "operational",
    configuration: "valid",
    database,
  };
}
