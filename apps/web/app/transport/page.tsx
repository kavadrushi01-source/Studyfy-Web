"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Bus } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, primaryBtn, secondaryBtn } from "@/lib/theme";

interface Stop {
  name: string;
  pickupTime: string | null;
}

interface Route {
  id: string;
  name: string;
  stops: Stop[];
  riderCount: number;
}

interface Ride {
  student: { id: string; name: string };
  route: { id: string; name: string; stops: Stop[] };
}

interface ApiError {
  error: { code: string; message: string };
}

// Transport (§7 Phase 2 #14, founder schema): fleet-level vehicles,
// routes carrying their stops as an ordered run, and a rider join —
// a pupil rides a route or doesn't, term to term. Office
// (admin/transport-manager) manages; pupils/parents see only own ride.
export default function TransportPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN" || user?.role === "TRANSPORT_MANAGER";
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [routeName, setRouteName] = useState("");
  const [addingRoute, setAddingRoute] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopTime, setStopTime] = useState("");
  const [pupilQuery, setPupilQuery] = useState("");
  const [pupilOptions, setPupilOptions] = useState<{ id: string; name: string }[]>([]);
  const [pupilId, setPupilId] = useState("");
  const [vehReg, setVehReg] = useState("");
  const [vehCapacity, setVehCapacity] = useState("40");
  const [driverName, setDriverName] = useState("");
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [fleetRefresh, setFleetRefresh] = useState(0);
  const [ridesRefresh, setRidesRefresh] = useState(0);

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/routes`);
      const body = (await response.json()) as { data: { routes: Route[] } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load routes.");
      }
      setRoutes(body.data.routes);
      if (!activeId && body.data.routes.length > 0) {
        setActiveId(body.data.routes[0]?.id ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, apiFetch, activeId]);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load();
  }, [ready, token, schoolId, apiFetch, load]);

  const active = routes.find((r) => r.id === activeId) ?? null;

  async function addRoute(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !routeName.trim()) {
      return;
    }
    setAddingRoute(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: routeName.trim() }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not add the route.");
      }
      setRouteName("");
      setNotice("Route added.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAddingRoute(false);
    }
  }

  async function removeRoute(): Promise<void> {
    if (!schoolId || !active) {
      return;
    }
    if (!window.confirm(`Remove route "${active.name}"? Riders must be moved off first.`)) {
      return;
    }
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/routes/${active.id}`, { method: "DELETE" });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not remove the route.");
      }
      setActiveId("");
      setNotice("Route removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function addStop(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !activeId || !stopName.trim()) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/routes/${activeId}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: stopName.trim(), ...(stopTime ? { pickupTime: stopTime } : {}) }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not add the stop.");
      }
      setStopName("");
      setStopTime("");
      setNotice("Stop added to the run.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function removeStop(index: number, name: string): Promise<void> {
    if (!schoolId || !active) {
      return;
    }
    if (!window.confirm(`Remove stop "${name}" from ${active.name}?`)) {
      return;
    }
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/routes/${active.id}/stops/${index}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not remove the stop.");
      }
      setNotice("Stop removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function findPupils(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !pupilQuery.trim()) {
      return;
    }
    try {
      const params = new URLSearchParams({ search: pupilQuery.trim(), pageSize: "10", sort: "name", order: "asc" });
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students?${params}`);
      const body = (await response.json()) as {
        data: { students: { id: string; user: { name: string } }[] };
      } | ApiError;
      if (!isFailure(response, body)) {
        setPupilOptions(body.data.students.map((s) => ({ id: s.id, name: s.user.name })));
      }
    } catch {
      // Picker stays as-is.
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !pupilId || !active) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: pupilId, routeId: active.id }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not assign the rider.");
      }
      setNotice("Rider assigned — re-assigning the same pupil moves them.");
      setPupilId("");
      setRidesRefresh((n) => n + 1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function unassign(studentId: string, name: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    if (!window.confirm(`Take ${name} off transport?`)) {
      return;
    }
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/assignments/${studentId}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not remove the rider.");
      }
      setNotice("Rider taken off transport.");
      setRidesRefresh((n) => n + 1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Transport</h1>
        <SkeletonBlocks rows={3} height={52} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Transport</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to view transport.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={{ ...h1Style, display: "flex", alignItems: "center", gap: 8, margin: "0 0 4px" }}>
        <Bus size={22} aria-hidden="true" color={colors.primary} /> Transport
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>Bus routes, stops, vehicles — and who rides where.</p>
      {loading ? (
        <SkeletonBlocks rows={3} height={52} />
      ) : routes.length === 0 ? (
        <EmptyState
          icon={<Bus size={22} aria-hidden="true" />}
          title="No routes yet"
          detail="The office adds the first route below — riders come after."
        />
      ) : (
        <>
          <div className="sf-row-wrap" style={{ gap: 8, marginBottom: 12 }} role="group" aria-label="Route">
            {routes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveId(r.id)}
                style={{
                  ...secondaryBtn,
                  borderColor: r.id === activeId ? colors.primary : "#DBE3EF",
                  color: r.id === activeId ? colors.primary : colors.inkSoft,
                  fontWeight: r.id === activeId ? 600 : 500,
                }}
              >
                {r.name} · {r.riderCount}
              </button>
            ))}
          </div>
          {active ? (
            <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
              <h2 style={{ ...h2Style }}>{active.name}</h2>
              <h3 style={{ ...h2Style, margin: "0 0 8px" }}>Stops in run order</h3>
              {active.stops.length === 0 ? (
                <p style={{ ...mutedStyle, fontSize: 13 }}>No stops yet — add the first below.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "grid", gap: 6 }}>
                  {active.stops.map((s, i) => (
                    <li
                      key={`${i}-${s.name}`}
                      style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, padding: "8px 0", borderTop: `1px solid ${colors.lineSoft}` }}
                    >
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 999,
                          background: colors.primaryGhost,
                          color: colors.primary,
                          fontWeight: 700,
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ flex: 1, fontWeight: 500 }}>
                        {s.name}
                        {s.pickupTime ? <span style={{ color: colors.muted, fontWeight: 400 }}> · {s.pickupTime}</span> : null}
                      </span>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => void removeStop(i, s.name)}
                          style={{ ...secondaryBtn, padding: "5px 12px", fontSize: 12 }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <form onSubmit={addStop} className="sf-row-wrap" style={{ marginBottom: 4 }}>
                  <input
                    className="sf-input"
                    style={{ flex: 2, minWidth: 180 }}
                    value={stopName}
                    onChange={(e) => setStopName(e.target.value)}
                    placeholder="New stop — e.g. Lakeview"
                    aria-label="Stop name"
                  />
                  <input
                    className="sf-input"
                    style={{ flex: 1, minWidth: 110 }}
                    value={stopTime}
                    onChange={(e) => setStopTime(e.target.value)}
                    placeholder="07:20"
                    aria-label="Pickup time"
                  />
                  <button type="submit" style={secondaryBtn}>
                    Add stop
                  </button>
                </form>
              ) : null}
              <RiderList
                schoolId={schoolId}
                apiFetch={apiFetch}
                routeId={active.id}
                canManage={canManage}
                refreshKey={ridesRefresh}
                onUnassign={(studentId, name) => void unassign(studentId, name)}
              />
              {canManage ? (
                <>
                  <form onSubmit={findPupils} className="sf-row-wrap" style={{ marginBottom: 8 }}>
                    <input
                      className="sf-input"
                      style={{ flex: 1, minWidth: 180 }}
                      value={pupilQuery}
                      onChange={(e) => setPupilQuery(e.target.value)}
                      placeholder="Find the pupil — e.g. Aditya Sharma"
                      aria-label="Find pupil"
                    />
                    <button type="submit" style={secondaryBtn}>
                      Find pupil
                    </button>
                  </form>
                  <form onSubmit={assign} style={{ marginTop: 4 }}>
                    <h3 style={{ ...h2Style, margin: "0 0 8px" }}>Assign a rider</h3>
                    <div className="sf-row-wrap">
                      <select
                        className="sf-select"
                        style={{ flex: 2, minWidth: 180 }}
                        value={pupilId}
                        onChange={(e) => setPupilId(e.target.value)}
                        required
                        aria-label="Rider pupil"
                      >
                        <option value="">— pick a pupil —</option>
                        {pupilOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" style={primaryBtn}>
                        Assign rider
                      </button>
                    </div>
                  </form>
                  <div style={{ marginTop: 16 }}>
                    <button type="button" onClick={() => void removeRoute()} style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13 }}>
                      Remove route
                    </button>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {canManage ? (
        <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
          <h2 style={{ ...h2Style }}>New route</h2>
          <form onSubmit={addRoute} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="sf-row-wrap">
              <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
                Route name
                <input className="sf-input" value={routeName} onChange={(e) => setRouteName(e.target.value)} required aria-label="Route name" />
              </label>
            </div>
            <div>
              <button type="submit" disabled={addingRoute} style={{ ...primaryBtn, opacity: addingRoute ? 0.6 : 1 }}>
                {addingRoute ? "Adding…" : "Add route"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {user?.role === "STUDENT" || user?.role === "PARENT" ? (
        <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
          <h2 style={{ ...h2Style }}>My ride</h2>
          <RideList schoolId={schoolId} apiFetch={apiFetch} />
        </section>
      ) : null}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
      {canManage ? (
        <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
          <h2 style={{ ...h2Style }}>Fleet</h2>
          <FleetList schoolId={schoolId} apiFetch={apiFetch} refreshKey={fleetRefresh} canManage={canManage} />
          <form onSubmit={addVehicle} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <h3 style={{ ...h2Style, margin: 0 }}>Add a vehicle</h3>
            <div className="sf-row-wrap">
              <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
                Registration number
                <input className="sf-input" value={vehReg} onChange={(e) => setVehReg(e.target.value)} required aria-label="Registration number" />
              </label>
              <label style={{ ...labelStyle, minWidth: 100 }}>
                Seats
                <input className="sf-input" inputMode="numeric" value={vehCapacity} onChange={(e) => setVehCapacity(e.target.value)} aria-label="Seat capacity" />
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
                Driver
                <input className="sf-input" value={driverName} onChange={(e) => setDriverName(e.target.value)} required aria-label="Driver name" />
              </label>
            </div>
            <div>
              <button type="submit" disabled={addingVehicle} style={{ ...primaryBtn, opacity: addingVehicle ? 0.6 : 1 }}>
                {addingVehicle ? "Adding…" : "Add vehicle"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );

  async function addVehicle(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !vehReg.trim() || !driverName.trim()) {
      return;
    }
    setAddingVehicle(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationNumber: vehReg.trim(),
          capacity: Number(vehCapacity) || 40,
          driverName: driverName.trim(),
        }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not add the vehicle.");
      }
      setVehReg("");
      setVehCapacity("40");
      setDriverName("");
      setFleetRefresh((n) => n + 1);
      setNotice("Vehicle added to the fleet.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAddingVehicle(false);
    }
  }
}

function FleetList({
  schoolId,
  apiFetch,
  refreshKey,
  canManage,
}: {
  schoolId: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  refreshKey: number;
  canManage: boolean;
}) {
  const [vehicles, setVehicles] = useState<{ id: string; registrationNumber: string; capacity: number; driverName: string }[]>([]);
  const [error, setError] = useState("");
  async function reload(): Promise<void> {
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/vehicles`);
      const body = (await response.json()) as {
        data: { vehicles: { id: string; registrationNumber: string; capacity: number; driverName: string }[] };
      } | ApiError;
      if (!isFailure(response, body)) {
        setVehicles(body.data.vehicles);
      }
    } catch {
      // Fleet list stays as-is.
    }
  }
  useEffect(() => {
    void reload();
  }, [schoolId, apiFetch, refreshKey]);
  async function remove(id: string, reg: string): Promise<void> {
    if (!window.confirm(`Retire vehicle "${reg}"?`)) {
      return;
    }
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/vehicles/${id}`, { method: "DELETE" });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not retire the vehicle.");
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }
  if (vehicles.length === 0) {
    return <p style={{ ...mutedStyle, fontSize: 13 }}>No vehicles yet.</p>;
  }
  return (
    <>
      <ul style={{ listStyle: "none", margin: "0 0 4px", padding: 0, display: "grid", gap: 6 }}>
        {vehicles.map((v) => (
          <li key={v.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1 }}>
              <strong>{v.registrationNumber}</strong> · {v.capacity} seats · {v.driverName}
            </span>
            {canManage ? (
              <button type="button" onClick={() => void remove(v.id, v.registrationNumber)} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
                Retire
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 13 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

function RiderList({
  schoolId,
  apiFetch,
  routeId,
  canManage,
  refreshKey,
  onUnassign,
}: {
  schoolId: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  routeId: string;
  canManage: boolean;
  refreshKey: number;
  onUnassign: (studentId: string, name: string) => void;
}) {
  const [riders, setRiders] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/rides`);
        const body = (await response.json()) as { data: { rides: Ride[] } } | ApiError;
        if (!isFailure(response, body)) {
          setRiders(
            body.data.rides.filter((r) => r.route.id === routeId).map((r) => ({ id: r.student.id, name: r.student.name })),
          );
        }
      } catch {
        // Riders stay as-is.
      }
    })();
  }, [schoolId, apiFetch, routeId, refreshKey]);
  return (
    <>
      <h3 style={{ ...h2Style, margin: "16px 0 8px" }}>
        Riders {riders.length > 0 ? <span style={{ color: colors.muted, fontWeight: 400 }}>· {riders.length}</span> : null}
      </h3>
      {riders.length === 0 ? (
        <p style={{ ...mutedStyle, fontSize: 13 }}>No riders on this route yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 4px", padding: 0, display: "grid", gap: 6 }}>
          {riders.map((r) => (
            <li key={r.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1 }}>{r.name}</span>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => onUnassign(r.id, r.name)}
                  style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}
                >
                  Take off
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RideList({
  schoolId,
  apiFetch,
}: {
  schoolId: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/transport/rides`);
        const body = (await response.json()) as { data: { rides: Ride[] } } | ApiError;
        if (!isFailure(response, body)) {
          setRides(body.data.rides);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      }
    })();
  }, [schoolId, apiFetch]);
  if (failed) {
    return <p style={{ ...mutedStyle, fontSize: 13 }}>Could not load your ride.</p>;
  }
  if (rides.length === 0) {
    return <p style={{ ...mutedStyle, fontSize: 13 }}>No ride assigned yet — the office assigns routes here.</p>;
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
      {rides.map((r) => (
        <li key={r.student.id} style={{ fontSize: 14, padding: "10px 0", borderTop: `1px solid ${colors.lineSoft}` }}>
          <strong>{r.student.name}</strong> · {r.route.name}
          {r.route.stops.length > 0 ? (
            <span style={{ color: colors.muted }}>
              {" "}
              · {r.route.stops.map((s) => `${s.name}${s.pickupTime ? ` (${s.pickupTime})` : ""}`).join(" → ")}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
