import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteSchema, defaultInlineContentSpecs, filterSuggestionItems } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import {
  createReactInlineContentSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  RiAddLine, RiArrowDownSLine, RiArrowLeftSLine, RiArrowRightSLine, RiCalendarLine,
  RiFileTextLine, RiMenuLine, RiMoreLine, RiSunLine,
} from "react-icons/ri";
import { Doc, loadAll, newId, openAttachment, remove, save, toDataUrl } from "./store";
import "./App.css";

// ---------- dates ----------
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());
const shift = (id: string, n: number) => {
  const d = new Date(id + "T12:00");
  d.setDate(d.getDate() + n);
  return iso(d);
};
const isDay = (id: string) => /^\d{4}-\d{2}-\d{2}$/.test(id);
const longDate = (id: string) =>
  new Date(id + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const parseDate = (q: string) => {
  if (isDay(q)) return q;
  if (q.length < 3 || !/\d/.test(q)) return null;
  const d = new Date(`${q} ${new Date().getFullYear()}`);
  return isNaN(+d) ? null : iso(d);
};

// ---------- links to documents and dates ----------
const titles = new Map<string, string>();
const label = (id: string, fallback = "") => (isDay(id) ? longDate(id) : titles.get(id) || fallback || "Untitled");

const Ref = createReactInlineContentSpec(
  { type: "ref", propSchema: { id: { default: "" }, label: { default: "" } }, content: "none" },
  { render: ({ inlineContent: { props } }) => <span className="ref" data-ref={props.id}>{label(props.id, props.label)}</span> },
);
const schema = BlockNoteSchema.create({ inlineContentSpecs: { ...defaultInlineContentSpecs, ref: Ref } });

// ---------- block helpers ----------
const walk = (blocks: any[]): any[] => blocks.flatMap((b) => [b, ...walk(b.children ?? [])]);
const inline = (b: any): any[] =>
  Array.isArray(b.content)
    ? b.content
    : (b.content?.rows ?? []).flatMap((r: any) => r.cells.flatMap((c: any) => (Array.isArray(c) ? c : c.content ?? [])));
const text = (b: any) =>
  inline(b).map((i) => i.text ?? (i.type === "ref" ? label(i.props.id, i.props.label) : i.content?.map((c: any) => c.text).join("") ?? "")).join("");
const stripIds = (blocks: any[]): any[] => blocks.map(({ id, children, ...b }) => ({ ...b, children: stripIds(children ?? []) }));
const openTasks = (blocks: any[]): any[] =>
  blocks.flatMap((b) => (b.type === "checkListItem" && !b.props.checked ? [b] : openTasks(b.children ?? [])));
const blankDay = (id: string): Doc => ({ id, kind: "day", title: "", blocks: [], updated: 0 });
const gone = new Set<string>(); // deleted this session: never save them again
let queue: Promise<unknown> = Promise.resolve(); // writes run one after another, so an older one never lands last

const winOpen = window.open.bind(window);
window.open = ((url?: string | URL, ...rest: any[]) =>
  String(url).startsWith("data:") ? (openAttachment(String(url)), null) : winOpen(url, ...rest)) as typeof window.open;

export default function App() {
  const [docs, setDocs] = useState<Record<string, Doc> | null>(null);
  const [route, setRoute] = useState<{ id: string; block?: string }>({ id: today() });
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadAll()
      .then((list) => setDocs(Object.fromEntries(list.map((d) => [d.id, d]))))
      .catch((e) => setError(String(e)));
  }, []);
  if (error) return <p className="error">Sheaf can't open Documents/Sheaf: {error}</p>;
  if (!docs) return null;
  for (const d of Object.values(docs)) titles.set(d.id, d.title);

  const put = (doc: Doc) => {
    if (gone.has(doc.id)) return Promise.resolve();
    setDocs((p) => ({ ...p, [doc.id]: doc }));
    const done = queue.then(() => (gone.has(doc.id) ? undefined : save(doc)));
    queue = done.catch((e) => alert(`Couldn't save "${doc.title || doc.id}": ${e}`));
    return done;
  };
  const open = (id: string, block?: string) => {
    setRoute({ id, block });
    setDrawer(false);
  };
  const create = (kind: Doc["kind"], parent?: string, blocks: any[] = [], title = "") => {
    const doc: Doc = { id: newId(), kind, title, parent, blocks, updated: Date.now() };
    put(doc);
    return doc;
  };
  const destroy = (id: string) => {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) for (const d of Object.values(docs)) if (d.parent === ids[i]) ids.push(d.id);
    ids.forEach((k) => gone.add(k));
    setDocs((p) => Object.fromEntries(Object.entries(p!).filter(([k]) => !gone.has(k))));
    queue = queue.then(() => Promise.all(ids.map(remove))).catch((e) => alert(`Couldn't delete: ${e}`));
    open(today());
  };

  const doc = docs[route.id] ?? (isDay(route.id) ? blankDay(route.id) : null);
  const ctx = { docs, put, open, create, destroy };

  return (
    <div className={`app ${navigator.userAgent.includes("Mac") && "__TAURI_INTERNALS__" in window ? "mac" : ""}`}>
      <aside className={`side ${drawer ? "open" : ""}`}>
        <button className={`item ${isDay(route.id) ? "on" : ""}`} onClick={() => open(today())}>
          <RiSunLine /> Today
        </button>
        <div className="head">
          Documents
          <button title="New document" onClick={() => open(create("doc").id)}>
            <RiAddLine />
          </button>
        </div>
        <Tree docs={docs} current={route.id} open={open} />
        {Object.values(docs).some((d) => d.kind === "template") && <div className="head">Templates</div>}
        {Object.values(docs)
          .filter((d) => d.kind === "template")
          .map((d) => (
            <button key={d.id} className={`item ${route.id === d.id ? "on" : ""}`} onClick={() => open(d.id)}>
              <RiFileTextLine /> {d.title || "Untitled"}
            </button>
          ))}
      </aside>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <main className="main">
        {doc ? <Page key={doc.id} doc={doc} focus={route.block} ctx={ctx} menu={() => setDrawer(true)} /> : null}
      </main>
    </div>
  );
}

function Tree({ docs, current, open, parent, depth = 0 }: any) {
  const [shut, setShut] = useState<Set<string>>(new Set());
  const all = Object.values(docs) as Doc[];
  return all
    .filter((d) => d.kind === "doc" && d.parent === parent)
    .sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled"))
    .map((d) => {
      const kids = all.some((k) => k.parent === d.id);
      return (
        <div key={d.id}>
          <button className={`item ${current === d.id ? "on" : ""}`} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => open(d.id)}>
            <span
              className={`twist ${kids ? "" : "none"} ${shut.has(d.id) ? "shut" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setShut((s) => (s.delete(d.id) ? new Set(s) : new Set(s.add(d.id))));
              }}
            >
              <RiArrowDownSLine />
            </span>
            <RiFileTextLine /> {d.title || "Untitled"}
          </button>
          {kids && !shut.has(d.id) && <Tree docs={docs} current={current} open={open} parent={d.id} depth={depth + 1} />}
        </div>
      );
    });
}

function Page({ doc, focus, ctx, menu }: { doc: Doc; focus?: string; ctx: any; menu: () => void }) {
  const { docs, put, open, create, destroy } = ctx;
  const editor = useCreateBlockNote({
    schema,
    initialContent: doc.blocks.length ? doc.blocks : undefined,
    uploadFile: toDataUrl,
  });
  const latest = useRef(doc);
  const [title, setTitle] = useState(doc.title);
  const [taskCount, setTaskCount] = useState(0);
  const [more, setMore] = useState(false);
  const [arm, setArm] = useState(false);

  const persist = (patch: Partial<Doc>) => {
    latest.current = { ...latest.current, ...patch, updated: Date.now() };
    put(latest.current); // every change is written right away
  };
  const countTasks = () => setTaskCount(openTasks(editor.document).length);

  useEffect(() => {
    countTasks();
    setTimeout(() => {
      const el = focus && document.querySelector(`.bn-block[data-id="${focus}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      editor.setTextCursorPosition(focus!, "end");
    }, 50);
  }, []);

  const target = doc.id < today() ? today() : shift(doc.id, 1);
  const rollover = async () => {
    const tasks = openTasks(editor.document);
    const t = docs[target] ?? blankDay(target);
    editor.isEditable = false; // nobody edits the moving tasks while the destination saves
    try {
      await put({ ...t, blocks: [...t.blocks, ...tasks], updated: Date.now() });
      editor.removeBlocks(tasks); // only once the destination is safely on disk
    } catch {
      // put already showed the error; the tasks stay here
    } finally {
      editor.isEditable = true;
    }
  };

  const backlinks = useMemo(
    () =>
      (Object.values(docs) as Doc[]).flatMap((d) =>
        d.id === doc.id
          ? []
          : walk(d.blocks)
              .filter((b) => inline(b).some((i) => i.type === "ref" && i.props.id === doc.id))
              .map((b) => ({ doc: d, block: b.id, text: text(b) })),
      ),
    [docs, doc.id],
  );

  const insertRef = (id: string, fallback: string) =>
    editor.insertInlineContent([{ type: "ref", props: { id, label: fallback } }, " "]);
  const pickLink = () => setTimeout(() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@"));
  const dateItem = (title: string, id: string) => ({
    title, subtext: longDate(id), icon: <RiCalendarLine />, onItemClick: () => insertRef(id, ""),
  });
  const atItems = async (q: string) => {
    const ql = q.toLowerCase();
    const parsed = parseDate(q);
    return [
      ...[["Today", today()], ["Tomorrow", shift(today(), 1)], ["Yesterday", shift(today(), -1)]]
        .filter(([t]) => t.toLowerCase().startsWith(ql))
        .map(([t, id]) => dateItem(t, id)),
      ...(parsed ? [dateItem(longDate(parsed), parsed)] : []),
      ...(Object.values(docs) as Doc[])
        .filter((d) => d.kind === "doc" && d.id !== doc.id && (d.title || "Untitled").toLowerCase().includes(ql))
        .slice(0, 8)
        .map((d) => ({
          title: d.title || "Untitled", subtext: "Document", icon: <RiFileTextLine />, onItemClick: () => insertRef(d.id, d.title),
        })),
    ];
  };
  const slashItems = async (q: string) =>
    filterSuggestionItems(
      [
        ...getDefaultReactSlashMenuItems(editor),
        { title: "Link to document", subtext: "Search by document title", aliases: ["link", "doc"], group: "Links", icon: <RiFileTextLine />, onItemClick: pickLink },
        { title: "Date link", subtext: "Link to a daily note", aliases: ["date", "day"], group: "Links", icon: <RiCalendarLine />, onItemClick: pickLink },
        ...(doc.kind === "doc"
          ? [{
              title: "Subdocument", subtext: "A new page inside this one", aliases: ["page", "sub"], group: "Links", icon: <RiAddLine />,
              onItemClick: () => insertRef(create("doc", doc.id).id, ""),
            }]
          : []),
      ],
      q,
    );

  const actions: [string, () => void][] =
    doc.kind === "day"
      ? [["Export PDF", () => window.print()]]
      : doc.kind === "template"
        ? [
            ["New document from template", () => open(create("doc", undefined, stripIds(editor.document), title).id)],
            [arm ? "Click again to delete" : "Delete template", () => (arm ? destroy(doc.id) : setArm(true))],
          ]
        : [
            ["New subdocument", () => open(create("doc", doc.id).id)],
            ["Save as template", () => open(create("template", undefined, stripIds(editor.document), title).id)],
            ["Export PDF", () => window.print()],
            [arm ? "Click again to delete" : "Delete", () => (arm ? destroy(doc.id) : setArm(true))],
          ];

  return (
    <>
      <div className="bar" data-tauri-drag-region>
        <button className="icon burger" onClick={menu} aria-label="Menu">
          <RiMenuLine />
        </button>
        <div className="grow" data-tauri-drag-region />
        <div className="more">
          <button className="icon" onClick={() => { setMore(!more); setArm(false); }} aria-label="More">
            <RiMoreLine />
          </button>
          {more && (
            <div className="pop">
              {actions.map(([t, f]) => (
                <button key={t} className={t.startsWith("Click again") ? "danger" : ""} onClick={() => { f(); if (!t.startsWith("Delete")) setMore(false); }}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="page" onClick={(e) => {
        const id = (e.target as HTMLElement).closest("[data-ref]")?.getAttribute("data-ref");
        if (id && (docs[id] || isDay(id))) open(id);
      }}>
        <header>
          {doc.kind === "day" ? (
            <div className="day">
              <h1>{longDate(doc.id)}</h1>
              <label className="icon pick">
                <RiArrowDownSLine />
                <input type="date" value={doc.id} onChange={(e) => e.target.value && open(e.target.value)} />
              </label>
              <div className="grow" />
              <button className="icon" onClick={() => open(shift(doc.id, -1))} aria-label="Previous day"><RiArrowLeftSLine /></button>
              {doc.id !== today() && <button className="chip" onClick={() => open(today())}>Today</button>}
              <button className="icon" onClick={() => open(shift(doc.id, 1))} aria-label="Next day"><RiArrowRightSLine /></button>
            </div>
          ) : (
            <>
              {doc.parent && docs[doc.parent] && (
                <button className="crumb" onClick={() => open(doc.parent!)}>{docs[doc.parent].title || "Untitled"}</button>
              )}
              {doc.kind === "template" && <div className="crumb">Template</div>}
              <input
                className="title" placeholder="Untitled" value={title} autoFocus={!title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  titles.set(doc.id, e.target.value);
                  persist({ title: e.target.value });
                }}
                onKeyDown={(e) => e.key === "Enter" && editor.focus()}
              />
            </>
          )}
        </header>
        {doc.kind === "day" && taskCount > 0 && (
          <button className="chip roll" onClick={rollover}>
            Move {taskCount} open {taskCount === 1 ? "task" : "tasks"} to {target === today() ? "today" : "tomorrow"}
          </button>
        )}
        <BlockNoteView editor={editor} slashMenu={false} onChange={() => { persist({ blocks: editor.document }); countTasks(); }}>
          <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
          <SuggestionMenuController triggerCharacter="@" getItems={atItems} />
        </BlockNoteView>
        {backlinks.length > 0 && (
          <section className="backlinks">
            <h2>Mentioned in</h2>
            {backlinks.map((l) => (
              <button key={l.doc.id + l.block} onClick={() => open(l.doc.id, l.block)}>
                <b>{l.doc.kind === "day" ? longDate(l.doc.id) : l.doc.title || "Untitled"}</b>
                <span>{l.text}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
