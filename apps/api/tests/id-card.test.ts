import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { generateStudentIdCard } from "../src/lib/id-card.js";

const app = createApp();

describe("student ID card PDF (SIS, spec §2/§8.5)", () => {
  it("renders a complete PDF document (header, objects, trailer)", async () => {
    const pdf = await generateStudentIdCard({
      schoolName: "School of Science",
      brandColor: "#0D9488",
      studentName: "Aditya Sharma",
      admissionNo: "SOS-9A-001",
      className: "Grade 9",
      sectionName: "A",
      dob: new Date("2011-05-14T00:00:00Z"),
    });

    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf.length).toBeGreaterThan(1024);
    expect((text.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("rejects unauthenticated ID-card requests with 401", async () => {
    await request(app).get("/api/v1/schools/whatever/students/whatever/id-card").expect(401);
  });
});
