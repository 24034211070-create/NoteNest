
import { useState } from "react";
import { Folder, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import "./NotesSidebar.css";

const DEFAULT_FOLDERS = [
    { id: "all", name: "All Notes", special: true },
    { id: "uncategorized", name: "Uncategorized", special: true },
    { id: "work", name: "Work" },
    { id: "personal", name: "Personal" },
    { id: "study", name: "Study" }
];

export default function NotesSidebar({
    folders = DEFAULT_FOLDERS,
    selectedFolder = "all",
    onSelectFolder = () => {},
    onCreateFolder = () => {},
    onRenameFolder = () => {},
    onDeleteFolder = () => {},
    notes = []
}) {
    const [creating, setCreating] = useState(false);
    const [folderName, setFolderName] = useState("");
    const [editingId, setEditingId] = useState("");
    const [editName, setEditName] = useState("");

    function createFolder(event) {
        event.preventDefault();
        const name = folderName.trim();
        if (!name) return;

        onCreateFolder(name);
        setFolderName("");
        setCreating(false);
    }

    function renameFolder(event) {
        event.preventDefault();
        const name = editName.trim();
        if (!name || !editingId) return;

        onRenameFolder(editingId, name);
        setEditingId("");
        setEditName("");
    }

    function countNotes(folderId) {
        if (folderId === "all") return notes.length;

        if (folderId === "uncategorized") {
            return notes.filter((note) => !note.folderId).length;
        }

        return notes.filter((note) => note.folderId === folderId).length;
    }

    return (
        <aside className="nns-sidebar">
            <div className="nns-heading">
                <div>
                    <h2>My Folders</h2>
                    <p>Organize your notes</p>
                </div>
                <button
                    type="button"
                    className="nns-add-button"
                    onClick={() => setCreating((value) => !value)}
                    aria-label="Create folder"
                    title="Create folder"
                >
                    {creating ? <X size={18} /> : <FolderPlus size={18} />}
                </button>
            </div>

            {creating && (
                <form className="nns-create-form" onSubmit={createFolder}>
                    <input
                        autoFocus
                        value={folderName}
                        onChange={(event) => setFolderName(event.target.value)}
                        placeholder="Folder name"
                        maxLength={40}
                        aria-label="New folder name"
                    />
                    <button type="submit">Add</button>
                </form>
            )}

            <div className="nns-folder-list">
                {folders.map((folder) => (
                    <div
                        key={folder.id}
                        className={`nns-folder-row ${
                            selectedFolder === folder.id ? "selected" : ""
                        }`}
                    >
                        {editingId === folder.id ? (
                            <form className="nns-rename-form" onSubmit={renameFolder}>
                                <input
                                    autoFocus
                                    value={editName}
                                    onChange={(event) => setEditName(event.target.value)}
                                    maxLength={40}
                                    aria-label="Rename folder"
                                />
                                <button type="submit">Save</button>
                            </form>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="nns-folder-select"
                                    onClick={() => onSelectFolder(folder.id)}
                                >
                                    <Folder size={18} />
                                    <span>{folder.name}</span>
                                    <small>{countNotes(folder.id)}</small>
                                </button>

                                {!folder.special && (
                                    <div className="nns-folder-actions">
                                        <button
                                            type="button"
                                            title="Rename folder"
                                            aria-label={`Rename ${folder.name}`}
                                            onClick={() => {
                                                setEditingId(folder.id);
                                                setEditName(folder.name);
                                            }}
                                        >
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            title="Delete folder"
                                            aria-label={`Delete ${folder.name}`}
                                            onClick={() => {
                                                if (window.confirm(
                                                    `Delete the "${folder.name}" folder? Its notes will become uncategorized.`
                                                )) {
                                                    onDeleteFolder(folder.id);
                                                }
                                            }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>

            <div className="nns-sidebar-footer">
                <Folder size={15} />
                <span>{notes.length} notes in total</span>
            </div>
        </aside>
    );
}
