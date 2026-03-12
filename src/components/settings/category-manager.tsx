'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, GripVertical, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  is_default: boolean;
}

export function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const { categories: cats } = await res.json();
        setCategories(cats ?? []);
      }
    } catch {
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleAdd = useCallback(async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
        }),
      });
      if (res.ok) {
        const { category } = await res.json();
        setCategories((prev) => [...prev, category]);
        setNewName('');
        setNewDescription('');
        setShowAddForm(false);
        toast.success(`Category "${category.name}" created`);
      } else {
        const { error } = await res.json();
        toast.error(error || 'Failed to create category');
      }
    } catch {
      toast.error('Failed to create category');
    } finally {
      setSaving(false);
    }
  }, [newName, newDescription]);

  const handleDelete = useCallback(async (cat: Category) => {
    if (!confirm(`Delete "${cat.name}"? Emails in this category won't be affected.`)) return;
    try {
      const res = await fetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      if (res.ok) {
        setCategories((prev) => prev.filter((c) => c.id !== cat.id));
        toast.success(`Deleted "${cat.name}"`);
      } else {
        toast.error('Failed to delete category');
      }
    } catch {
      toast.error('Failed to delete category');
    }
  }, []);

  const startEdit = useCallback((cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDescription(cat.description ?? '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName('');
    setEditDescription('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/categories/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
        }),
      });
      if (res.ok) {
        const { category } = await res.json();
        setCategories((prev) =>
          prev.map((c) => (c.id === editingId ? category : c))
        );
        cancelEdit();
        toast.success('Category updated');
      } else {
        const { error } = await res.json();
        toast.error(error || 'Failed to update');
      }
    } catch {
      toast.error('Failed to update category');
    } finally {
      setSaving(false);
    }
  }, [editingId, editName, editDescription, cancelEdit]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Category list */}
      <div className="border border-border rounded-lg divide-y divide-border">
        {categories.map((cat) => (
          <div key={cat.id} className="flex items-center gap-3 px-4 py-3">
            <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />

            {editingId === cat.id ? (
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  placeholder="Category name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground"
                  placeholder="Description (helps AI understand this category)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <div className="flex gap-1">
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-accent"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{cat.name}</p>
                  {cat.description && (
                    <p className="text-xs text-muted-foreground truncate">{cat.description}</p>
                  )}
                </div>
                <button
                  onClick={() => startEdit(cat)}
                  className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(cat)}
                  className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}

        {categories.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No categories yet. Add one below.
          </div>
        )}
      </div>

      {/* Add new category */}
      {showAddForm ? (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Category name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setShowAddForm(false); setNewName(''); setNewDescription(''); }
            }}
          />
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-muted-foreground"
            placeholder="Description (helps AI understand this category)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setShowAddForm(false); setNewName(''); setNewDescription(''); }
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add Category
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewName(''); setNewDescription(''); }}
              className="px-3 py-1.5 text-sm rounded-md hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add category
        </button>
      )}
    </div>
  );
}
