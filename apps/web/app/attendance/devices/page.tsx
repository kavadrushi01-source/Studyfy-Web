"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Fingerprint } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface Device {
  id: string;
  name: string;
  location: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

interface PupilHit {
  id: string;
  name: string;
  deviceUserId: string | null;
}

interface ApiError {
  error: { code: string; message: string };
}

// Biometric/RFID terminals (§7 Phase 3 #21, admin-only): enroll a unit
// (the key shows ONCE — copy it into the terminal now, it is never shown
// again), suspend/resume it, and map enrollment IDs to pupils so punches
// resolve. Punch import itself is machine-to-machine (device key), never
// this screen.
export default function DevicesPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN";
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [freshKey, setFreshKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [togglingId, setTogglingId] = useState("");
  const [pupilQuery, setPupilQuery] = useState("");
  const [hits, setHits] = useState<PupilHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [deviceIds, setDeviceIds] = useState<Record<string, string>>({});
  const [mappingId, setMappingId] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/biometric/devices`);
      const body = (await response.json()) as { data: { devices: Device[] } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load devices.");
      }
      setDevices(body.data.devices);
    } catch (err) {
      setDevices([]);
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, apiFetch]);

  useEffect(() => {
    if (!ready || !token || !schoolId || !canManage) {
      return;
    }
    void load();
  }, [ready, token, schoolId, apiFetch, canManage, load]);

  async function enroll(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      return;
    }
    setEnrolling(true);
    setError("");
    setNotice("");
    setFreshKey("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/biometric/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), location: location.trim() || undefined }),
      });
      const body = (await response.json()) as { data: { deviceKey: string } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Enrollment failed.");
      }
      setFreshKey(body.data.deviceKey);
      setName("");
      setLocation("");
      setNotice("Terminal enrolled — copy the key below into it now.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setEnrolling(false);
    }
  }

  async function toggle(device: Device): Promise<void> {
    if (!schoolId) {
      return;
    }
    setTogglingId(device.id);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/biometric/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !device.isActive }),
      });
      const body = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Update failed.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setTogglingId("");
    }
  }

  async function searchPupils(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !pupilQuery.trim()) {
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ search: pupilQuery.trim(), pageSize: "10" });
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students?${params}`);
      const body = (await response.json()) as {
        data: { students: { id: string; user?: { name?: string }; name?: string; deviceUserId?: string | null }[] };
      } | ApiError;
      if (!isFailure(response, body)) {
        setHits(
          body.data.students.map((s) => ({
            id: s.id,
            name: s.name ?? s.user?.name ?? "—",
            deviceUserId: s.deviceUserId ?? null,
          })),
        );
        setDeviceIds(Object.fromEntries(body.data.students.map((s) => [s.id, s.deviceUserId ?? ""])));
      }
    } catch {
      // Search stays as-is on failure; the list is a convenience.
    } finally {
      setSearching(false);
    }
  }

  async function mapPupil(studentId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    const raw = (deviceIds[studentId] ?? "").trim();
    setMappingId(studentId);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/biometric/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, deviceUserId: raw === "" ? null : raw }),
      });
      const body = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Mapping failed.");
      }
      setNotice(raw === "" ? "Device ID unmapped." : `Mapped to device ID ${raw}.`);
      setHits((prev) => prev.map((h) => (h.id === studentId ? { ...h, deviceUserId: raw === "" ? null : raw } : h)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setMappingId("");
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Biometric terminals</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Biometric terminals</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to manage terminals.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Biometric terminals</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            Terminals belong to the school office — your boards carry your own figures.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Biometric terminals</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Fingerprint/RFID units whose taps land as attendance. Terminals authenticate with their own keys —
        punches resolve through the enrollment IDs mapped below.
      </p>

      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={h2Style}>Enroll a terminal</h2>
        <form onSubmit={enroll} className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
          <label style={{ ...labelStyle, flex: 2, minWidth: 200 }}>
            Name
            <input
              className="sf-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              aria-label="Terminal name"
              placeholder="Main gate unit"
            />
          </label>
          <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
            Location (optional)
            <input
              className="sf-input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              aria-label="Terminal location"
            />
          </label>
          <button type="submit" disabled={enrolling} style={{ ...primaryBtn, opacity: enrolling ? 0.6 : 1 }}>
            {enrolling ? "Enrolling…" : "Enroll terminal"}
          </button>
        </form>
        {freshKey ? (
          <div
            role="status"
            style={{ marginTop: 12, background: "#FFFBEB", border: "1px solid #F59E0B", borderRadius: 12, padding: 12 }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, color: "#92400E", margin: "0 0 6px" }}>
              Copy this key into the terminal now — it is never shown again:
            </p>
            <code style={{ fontSize: 13, wordBreak: "break-all", color: colors.ink }}>{freshKey}</code>
          </div>
        ) : null}
      </section>

      {loading ? (
        <SkeletonBlocks rows={3} />
      ) : devices.length === 0 ? (
        <EmptyState
          icon={<Fingerprint size={22} aria-hidden="true" />}
          title="No terminals enrolled"
          detail="Enroll the first unit above to start receiving taps."
        />
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "grid", gap: 12 }}>
          {devices.map((d) => (
            <li key={d.id} className="sf-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: colors.ink, fontSize: 15, flex: 1 }}>{d.name}</strong>
                <span style={pill(d.isActive ? colors.success : colors.danger, d.isActive ? colors.successTint : colors.dangerTint)}>
                  {d.isActive ? "Active" : "Suspended"}
                </span>
                <button
                  type="button"
                  onClick={() => void toggle(d)}
                  disabled={togglingId === d.id}
                  className="sf-btn"
                >
                  {d.isActive ? "Suspend" : "Resume"}
                </button>
              </div>
              <p style={{ ...mutedStyle, fontSize: 13, margin: "6px 0 0" }}>
                {d.location ?? "No location"} · last tap{" "}
                {d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString("en-GB") : "never"}
              </p>
            </li>
          ))}
        </ul>
      )}

      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={h2Style}>Map enrollment IDs to pupils</h2>
        <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 12px" }}>
          The ID the terminal sends for a finger or card. Clear the box and save to unmap.
        </p>
        <form onSubmit={searchPupils} className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
          <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
            Pupil name
            <input
              className="sf-input"
              value={pupilQuery}
              onChange={(e) => setPupilQuery(e.target.value)}
              aria-label="Search pupils"
              placeholder="Aditya Sharma"
            />
          </label>
          <button type="submit" disabled={searching} style={{ ...primaryBtn, opacity: searching ? 0.6 : 1 }}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {hits.length > 0 ? (
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
            {hits.map((h) => (
              <li key={h.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 14 }}>
                <span style={{ flex: 1, minWidth: 140, color: colors.ink, fontWeight: 600 }}>
                  {h.name}
                  {h.deviceUserId ? (
                    <span style={{ ...mutedStyle, fontWeight: 400 }}> · {h.deviceUserId}</span>
                  ) : null}
                </span>
                <input
                  className="sf-input"
                  style={{ width: 160 }}
                  value={deviceIds[h.id] ?? ""}
                  onChange={(e) => setDeviceIds((prev) => ({ ...prev, [h.id]: e.target.value }))}
                  placeholder="Device ID"
                  aria-label={`Device ID for ${h.name}`}
                />
                <button
                  type="button"
                  onClick={() => void mapPupil(h.id)}
                  disabled={mappingId === h.id}
                  className="sf-btn"
                >
                  Save mapping
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
