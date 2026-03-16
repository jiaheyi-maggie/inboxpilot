'use client';

import { format } from 'date-fns';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Paperclip,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { EmailWithCategory } from '@/types';

interface BoardCardProps {
  email: EmailWithCategory;
  onSelect: (emailId: string) => void;
  /** True when this card is being rendered inside a DragOverlay (clone, not in-place) */
  overlay?: boolean;
  /** Account color for multi-inbox dot indicator */
  accountColor?: string;
}

export function BoardCard({ email, onSelect, overlay, accountColor }: BoardCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: email.id,
    data: { type: 'card', email },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const date = email.received_at
    ? format(new Date(email.received_at), 'MMM d')
    : '';

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={(e) => {
        // Don't trigger select on drag
        if (isDragging) return;
        e.stopPropagation();
        onSelect(email.id);
      }}
      className={`rounded-lg border border-border bg-card p-3 cursor-grab active:cursor-grabbing
        hover:border-primary/30 hover:shadow-sm transition-[border-color,box-shadow]
        ${overlay ? 'shadow-lg ring-2 ring-primary/20 rotate-[2deg]' : ''}
        ${!email.is_read ? 'border-l-[3px] border-l-primary' : ''}
      `}
    >
      {/* Sender + date row */}
      <div className="flex items-center gap-1.5 min-w-0">
        {accountColor && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: accountColor }}
            aria-hidden="true"
          />
        )}
        <span className={`text-xs truncate flex-1 ${!email.is_read ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
          {email.sender_name || email.sender_email || 'Unknown'}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {email.has_attachment && (
            <Paperclip className="h-3 w-3 text-muted-foreground" />
          )}
          {email.is_starred && (
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          )}
          <span className="text-[10px] text-muted-foreground">{date}</span>
        </div>
      </div>

      {/* Subject */}
      <p className={`text-sm mt-1 line-clamp-2 leading-snug ${!email.is_read ? 'font-medium text-foreground' : 'text-foreground/80'}`}>
        {email.subject || '(no subject)'}
      </p>

      {/* Importance badge */}
      <div className="flex items-center gap-1.5 mt-2">
        {email.importance_label === 'critical' && (
          <Badge variant="critical" className="text-[10px] px-1.5 py-0"><ChevronsUp className="h-2.5 w-2.5" /> Critical</Badge>
        )}
        {email.importance_label === 'high' && (
          <Badge variant="high" className="text-[10px] px-1.5 py-0"><ChevronUp className="h-2.5 w-2.5" /> High</Badge>
        )}
        {email.importance_label === 'low' && (
          <Badge variant="low" className="text-[10px] px-1.5 py-0"><ChevronDown className="h-2.5 w-2.5" /> Low</Badge>
        )}
        {email.importance_label === 'noise' && (
          <Badge variant="noise" className="text-[10px] px-1.5 py-0"><ChevronsDown className="h-2.5 w-2.5" /> Noise</Badge>
        )}
      </div>
    </div>
  );
}
