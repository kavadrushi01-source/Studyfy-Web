"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn, secondaryBtn } from "@/lib/theme";

interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string;
  totalCopies: number;
  availableCopies: number;
}

interface LoanRow {
  id: string;
  status: "ISSUED" | "RETURNED" | "OVERDUE";
  issuedAt: string;
  dueAt: string;
  returnedAt: string | null;
  fine: string;
  book: { id: string; title: string; author: string };
  student: { id: string; name: string };
  issuer: { name: string };
}

interface PupilOption {
  id: string;
  name: string;
}

interface ApiError {
  error: { code: string; message: string };
}

// Library (§7 Phase 2 #13): catalog for everyone, issue/return desk for
// staff with library.manage, my-loans for pupils/parents (self-scope pins
// them server-side). Overdue is derived, never stored.
export default function LibraryPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN" || user?.role === "LIBRARIAN";
  const seesLoans = canManage || user?.role === "STUDENT" || user?.role === "PARENT";
  const [books, setBooks] = useState<BookRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [bookTotal, setBookTotal] = useState(0);
  const [bookPages, setBookPages] = useState(1);
  const [bookPage, setBookPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Add-book form.
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [bookCategory, setBookCategory] = useState("");
  const [copies, setCopies] = useState("3");
  const [adding, setAdding] = useState(false);
  // Edit panel (prefilled from the row; Save PATCHes only changed fields
  // server-side — shrinking below issued copies is refused with the count).
  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editIsbn, setEditIsbn] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editCopies, setEditCopies] = useState("");
  const [saving, setSaving] = useState(false);
  // Issue desk.
  const [issueBookId, setIssueBookId] = useState("");
  const [pupilQuery, setPupilQuery] = useState("");
  const [pupilOptions, setPupilOptions] = useState<PupilOption[]>([]);
  const [pupilId, setPupilId] = useState("");
  const [dueDays, setDueDays] = useState("14");
  const [issuing, setIssuing] = useState(false);
  // Loans board.
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [loanStatus, setLoanStatus] = useState("");
  const [loansLoading, setLoansLoading] = useState(false);
  const [finePerDay, setFinePerDay] = useState(5);
  const [rateInput, setRateInput] = useState("5");
  const [savingRate, setSavingRate] = useState(false);
  const rateSeeded = useRef(false);

  const loadBooks = useCallback(
    async (next: { search: string; category: string; availableOnly: boolean; page: number }) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(next.page), pageSize: "20" });
        if (next.search.trim()) {
          params.set("search", next.search.trim());
        }
        if (next.category) {
          params.set("category", next.category);
        }
        if (next.availableOnly) {
          params.set("available", "true");
        }
        const response = await apiFetch(`/api/v1/schools/${schoolId}/library/books?${params}`);
        const body = (await response.json()) as {
          data: { books: BookRow[]; categories: string[]; total: number; totalPages: number };
        } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load catalog.");
        }
        setBooks(body.data.books);
        setCategories(body.data.categories);
        setBookTotal(body.data.total);
        setBookPages(body.data.totalPages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  const loadLoans = useCallback(
    async (status: string) => {
      if (!schoolId) {
        return;
      }
      setLoansLoading(true);
      try {
        const params = new URLSearchParams({ pageSize: "50" });
        if (status) {
          params.set("status", status);
        }
        const response = await apiFetch(`/api/v1/schools/${schoolId}/library/loans?${params}`);
        const body = (await response.json()) as { data: { loans: LoanRow[]; finePerDay: number } } | ApiError;
        if (!isFailure(response, body)) {
          setLoans(body.data.loans);
          setFinePerDay(body.data.finePerDay);
          // Seed the editor once from the server; afterwards the field is
          // the admin's until they save (reloads must not clobber typing).
          if (!rateSeeded.current) {
            rateSeeded.current = true;
            setRateInput(String(body.data.finePerDay));
          }
        }
      } catch {
        // Loans board stays stale — catalog above still works.
      } finally {
        setLoansLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void loadBooks({ search: "", category: "", availableOnly: false, page: 1 });
    if (seesLoans) {
      void loadLoans("");
    }
  }, [ready, token, schoolId, apiFetch, loadBooks, loadLoans, seesLoans]);

  function applyFilter(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setBookPage(1);
    void loadBooks({ search, category, availableOnly, page: 1 });
  }

  async function addBook(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      return;
    }
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/library/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          author: author.trim(),
          ...(isbn.trim() ? { isbn: isbn.trim() } : {}),
          ...(bookCategory.trim() ? { category: bookCategory.trim() } : {}),
          totalCopies: Number(copies) || 1,
        }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not add the book.");
      }
      setTitle("");
      setAuthor("");
      setIsbn("");
      setBookCategory("");
      setCopies("3");
      setNotice("Book added to the catalog.");
      setBookPage(1);
      await loadBooks({ search: "", category: "", availableOnly: false, page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAdding(false);
    }
  }

  async function searchPupils(event: FormEvent<HTMLFormElement>): Promise<void> {
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

  async function issue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !issueBookId || !pupilId) {
      return;
    }
    setIssuing(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/library/books/${issueBookId}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: pupilId, dueDays: Number(dueDays) || 14 }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not issue the book.");
      }
      setNotice("Issued — due date set on the loan.");
      setPupilId("");
      setIssueBookId("");
      await loadBooks({ search, category, availableOnly, page: bookPage });
      await loadLoans(loanStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setIssuing(false);
    }
  }

  function startEdit(row: BookRow): void {
    setEditingId(row.id);
    setEditTitle(row.title);
    setEditAuthor(row.author);
    setEditIsbn(row.isbn ?? "");
    setEditCategory(row.category);
    setEditCopies(String(row.totalCopies));
    setError("");
    setNotice("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !editingId) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/library/books/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          author: editAuthor.trim(),
          isbn: editIsbn.trim() || null,
          category: editCategory.trim() || "General",
          totalCopies: Number(editCopies) || 1,
        }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not save the book.");
      }
      setNotice("Book updated.");
      setEditingId("");
      await loadBooks({ search, category, availableOnly, page: bookPage });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function removeBook(bookId: string, title: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/library/books/${bookId}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not remove the book.");
      }
      setNotice(`Removed "${title}" from the catalog.`);
      setBookPage(1);
      await loadBooks({ search: "", category: "", availableOnly: false, page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function saveRate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      return;
    }
    setSavingRate(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/library/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finePerDay: Number(rateInput) }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not save the rate.");
      }
      setNotice(`Fine rate saved — ₹${rateInput} per overdue day from now on.`);
      await loadLoans(loanStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSavingRate(false);
    }
  }

  async function takeReturn(loanId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/library/loans/${loanId}/return`, {
        method: "POST",
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Return failed.");
      }
      setNotice("Returned — back on the shelf.");
      await loadBooks({ search, category, availableOnly, page: bookPage });
      await loadLoans(loanStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  function loanPill(status: LoanRow["status"]): React.CSSProperties {
    const tone = status === "RETURNED" ? colors.success : status === "OVERDUE" ? colors.danger : colors.primary;
    const tint = status === "RETURNED" ? colors.successTint : status === "OVERDUE" ? colors.dangerTint : colors.primaryGhost;
    return pill(tone, tint);
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-GB");
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Library</h1>
        <SkeletonBlocks rows={3} height={52} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Library</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to browse the library.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={{ ...h1Style, display: "flex", alignItems: "center", gap: 8 }}>
        <BookOpen size={22} aria-hidden="true" color={colors.primary} /> Library
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        {bookTotal} title{bookTotal === 1 ? "" : "s"} on the shelf — borrow for two weeks, bring back on time.
      </p>
      <form onSubmit={applyFilter} className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <input
          className="sf-input"
          style={{ flex: 2, minWidth: 200 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, author, ISBN…"
          aria-label="Search catalog"
        />
        <select
          className="sf-select"
          style={{ minWidth: 150 }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: colors.inkSoft }}>
          <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} aria-label="Available only" />
          Available only
        </label>
        <button type="submit" style={primaryBtn}>
          Filter
        </button>
      </form>
      <DataTable<BookRow>
        columns={[
          { key: "title", label: "Title", render: (r) => <span style={{ fontWeight: 600 }}>{r.title}</span> },
          { key: "author", label: "Author", render: (r) => <span style={{ color: colors.inkSoft }}>{r.author}</span> },
          { key: "category", label: "Category", render: (r) => <span style={{ color: colors.muted }}>{r.category}</span> },
          {
            key: "copies",
            label: "On shelf",
            render: (r) => (
              <span style={{ fontWeight: 600, color: r.availableCopies > 0 ? colors.success : colors.danger }}>
                {r.availableCopies}/{r.totalCopies}
              </span>
            ),
          },
          ...(canManage
            ? [
                {
                  key: "actions",
                  label: "Manage",
                  render: (r: BookRow) => (
                    <span style={{ display: "inline-flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13 }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeBook(r.id, r.title)}
                        style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13 }}
                      >
                        Remove
                      </button>
                    </span>
                  ),
                },
              ]
            : []),
        ]}
        rows={books}
        rowKey={(r) => r.id}
        sort="title"
        order="asc"
        onSort={() => undefined}
        page={bookPage}
        totalPages={bookPages}
        total={bookTotal}
        onPage={(next) => {
          setBookPage(next);
          void loadBooks({ search, category, availableOnly, page: next });
        }}
        loading={loading}
        emptyMessage="No books match — the shelf starts empty until the office adds titles."
      />
      {canManage ? (
        <>
          <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
            <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 4px" }}>Fine policy</h2>
            <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 12px" }}>
              Flat rupees per overdue day for this school — priced live on open loans, frozen on
              returns (rate changes never rewrite history). Zero switches fines off.
            </p>
            <form onSubmit={saveRate} className="sf-row-wrap">
              <label style={{ ...labelStyle, minWidth: 140 }}>
                Fine rupees per day
                <input
                  className="sf-input"
                  inputMode="numeric"
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  aria-label="Fine rupees per day"
                />
              </label>
              <button type="submit" disabled={savingRate} style={{ ...secondaryBtn, alignSelf: "flex-end", opacity: savingRate ? 0.6 : 1 }}>
                {savingRate ? "Saving…" : "Save rate"}
              </button>
              <span style={{ alignSelf: "flex-end", fontSize: 13, color: colors.muted, paddingBottom: 8 }}>
                Current: ₹{finePerDay}/day
              </span>
            </form>
          </section>
          <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
            <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 12px" }}>Add a title</h2>
            <form onSubmit={addBook} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="sf-row-wrap">
                <label style={{ ...labelStyle, flex: 2, minWidth: 200 }}>
                  Title
                  <input className="sf-input" value={title} onChange={(e) => setTitle(e.target.value)} required aria-label="Book title" />
                </label>
                <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
                  Author
                  <input className="sf-input" value={author} onChange={(e) => setAuthor(e.target.value)} required aria-label="Book author" />
                </label>
              </div>
              <div className="sf-row-wrap">
                <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
                  ISBN (optional)
                  <input className="sf-input" value={isbn} onChange={(e) => setIsbn(e.target.value)} aria-label="Book ISBN" />
                </label>
                <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
                  Category
                  <input
                    className="sf-input"
                    value={bookCategory}
                    onChange={(e) => setBookCategory(e.target.value)}
                    placeholder="General"
                    aria-label="Book category"
                  />
                </label>
                <label style={{ ...labelStyle, minWidth: 110 }}>
                  Copies
                  <input
                    className="sf-input"
                    inputMode="numeric"
                    value={copies}
                    onChange={(e) => setCopies(e.target.value)}
                    aria-label="Total copies"
                  />
                </label>
              </div>
              <div>
                <button type="submit" disabled={adding} style={{ ...primaryBtn, opacity: adding ? 0.6 : 1 }}>
                  {adding ? "Adding…" : "Add to catalog"}
                </button>
              </div>
            </form>
          </section>
          {editingId ? (
            <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
              <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 12px" }}>Edit title</h2>
              <form onSubmit={saveEdit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="sf-row-wrap">
                  <label style={{ ...labelStyle, flex: 2, minWidth: 200 }}>
                    Title
                    <input className="sf-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required aria-label="Edit title" />
                  </label>
                  <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
                    Author
                    <input className="sf-input" value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} required aria-label="Edit author" />
                  </label>
                </div>
                <div className="sf-row-wrap">
                  <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
                    ISBN (optional)
                    <input className="sf-input" value={editIsbn} onChange={(e) => setEditIsbn(e.target.value)} aria-label="Edit ISBN" />
                  </label>
                  <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
                    Category
                    <input className="sf-input" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} aria-label="Edit category" />
                  </label>
                  <label style={{ ...labelStyle, minWidth: 110 }}>
                    Copies
                    <input className="sf-input" inputMode="numeric" value={editCopies} onChange={(e) => setEditCopies(e.target.value)} aria-label="Edit total copies" />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <button type="button" onClick={() => setEditingId("")} style={secondaryBtn}>
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
            <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 12px" }}>Issue desk</h2>
            <form onSubmit={searchPupils} className="sf-row-wrap" style={{ marginBottom: 12 }}>
              <input
                className="sf-input"
                style={{ flex: 1, minWidth: 200 }}
                value={pupilQuery}
                onChange={(e) => setPupilQuery(e.target.value)}
                placeholder="Find the pupil first — e.g. Aditya Sharma"
                aria-label="Find pupil"
              />
              <button type="submit" style={secondaryBtn}>
                Find
              </button>
            </form>
            <form onSubmit={issue} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="sf-row-wrap">
                <label style={{ ...labelStyle, flex: 2, minWidth: 200 }}>
                  Pupil
                  <select className="sf-select" value={pupilId} onChange={(e) => setPupilId(e.target.value)} required aria-label="Issue to pupil">
                    <option value="">— pick a pupil —</option>
                    {pupilOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...labelStyle, flex: 2, minWidth: 200 }}>
                  Book (from the catalog above)
                  <select
                    className="sf-select"
                    value={issueBookId}
                    onChange={(e) => setIssueBookId(e.target.value)}
                    required
                    aria-label="Pick book to issue"
                  >
                    <option value="">— pick a book —</option>
                    {books
                      .filter((b) => b.availableCopies > 0)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title} — {b.availableCopies} left
                        </option>
                      ))}
                  </select>
                </label>
                <label style={{ ...labelStyle, minWidth: 110 }}>
                  Loan days
                  <input
                    className="sf-input"
                    inputMode="numeric"
                    value={dueDays}
                    onChange={(e) => setDueDays(e.target.value)}
                    aria-label="Loan days"
                  />
                </label>
              </div>
              <div>
                <button type="submit" disabled={issuing || !pupilId || !issueBookId} style={{ ...primaryBtn, opacity: issuing ? 0.6 : 1 }}>
                  {issuing ? "Issuing…" : "Issue book"}
                </button>
                <p style={{ fontSize: 12, color: colors.muted, margin: "8px 0 0" }}>
                  Overdue fine: ₹{finePerDay}/day after the due date.
                </p>
              </div>
            </form>
          </section>
        </>
      ) : null}
      {seesLoans ? (
        <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...h1Style, fontSize: 18, margin: 0 }}>{canManage ? "Loans board" : "My loans"}</h2>
            <select
              className="sf-select"
              style={{ marginLeft: "auto", minWidth: 140 }}
              value={loanStatus}
              onChange={(e) => {
                setLoanStatus(e.target.value);
                void loadLoans(e.target.value);
              }}
              aria-label="Filter loans by status"
            >
              <option value="">All loans</option>
              <option value="ISSUED">Issued</option>
              <option value="OVERDUE">Overdue</option>
              <option value="RETURNED">Returned</option>
            </select>
          </div>
          {loansLoading ? (
            <SkeletonBlocks rows={2} height={44} />
          ) : loans.length === 0 ? (
            <p style={{ ...mutedStyle, margin: 0, fontSize: 14 }}>Nothing here — no books out right now.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {loans.map((l) => (
                <li
                  key={l.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "10px 0",
                    borderTop: `1px solid ${colors.lineSoft}`,
                    fontSize: 14,
                  }}
                >
                  <span style={{ flex: 1, color: colors.ink }}>
                    <strong>{l.book.title}</strong> <span style={{ color: colors.muted }}>· {l.student.name}</span>
                    <br />
                    <span style={{ fontSize: 12, color: colors.muted }}>
                      Due {fmtDate(l.dueAt)}
                      {l.returnedAt ? ` · returned ${fmtDate(l.returnedAt)}` : ""} · {l.issuer.name}
                      {l.fine !== "0.00" ? ` · fine ₹${l.fine}` : ""}
                    </span>
                  </span>
                  <span style={loanPill(l.status)}>{l.status}</span>
                  {canManage && !l.returnedAt ? (
                    <button type="button" onClick={() => void takeReturn(l.id)} style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13 }}>
                      Return
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
