import { describe, expect, it } from "vitest";
import { connectionOptions } from "./db-options";

describe("connectionOptions", () => {
  it("uses plain connections and prepared statements for the local container", () => {
    expect(connectionOptions("postgres://reply:pw@127.0.0.1:5433/reply")).toMatchObject({
      ssl: false,
      prepare: true,
    });
    expect(connectionOptions("postgres://reply:pw@localhost:5433/reply")).toMatchObject({ ssl: false });
  });

  it("requires TLS for a hosted database even when the URL has no sslmode", () => {
    expect(connectionOptions("postgresql://u:pw@ep-x.c-4.ap-southeast-1.aws.neon.tech/neondb")).toMatchObject({
      ssl: "require",
      prepare: true,
    });
  });

  it("turns prepared statements off behind a transaction pooler", () => {
    expect(
      connectionOptions("postgresql://u:pw@ep-x-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"),
    ).toMatchObject({ ssl: "require", prepare: false });
  });

  it("keeps the pool small", () => {
    expect(connectionOptions("postgres://u:pw@db.example.com/x").max).toBe(5);
  });
});
