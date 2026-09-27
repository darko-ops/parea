'use client';

/**
 * The Chat page, as one owner of one query.
 *
 * The search moved into the head — a disc in the leading corner that opens
 * into a field, which is what the app does and what Home already did — and the
 * head is `NewGroupPanel` while the list is `GroupChats`. Two siblings, one
 * query between them, so something has to hold it. This is that something, and
 * deliberately nothing else: the head is still the head and the list is still
 * the list.
 *
 * ## Why the empty state arrives as children
 *
 * It is prose with links in it and it belongs to the page, which is a server
 * component and can say it without shipping a word of it to a browser. Passing
 * it down keeps it there. What this decides is only *whether* it is shown,
 * which is a thing you can only know at the same moment you know whether there
 * is anything to search.
 */

import { useState } from 'react';

import { NewGroupPanel } from './CreateGroupCard';
import { GroupChats, type ChatRow } from './GroupChats';
import { SearchControl } from './SearchControl';

export function ChatView({
  greeting,
  chats,
  children,
}: {
  greeting: string | null;
  chats: ChatRow[];
  /** What a page with no rooms says instead of a list. */
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  /*
   * No control where there is nothing to search.
   *
   * The app hides it for the same reason: on a tab with no rooms it is a
   * control that cannot succeed, sitting in the corner above the paragraph
   * explaining why there is nothing here.
   */
  const searchable = chats.length > 0;

  return (
    <>
      <NewGroupPanel
        greeting={greeting}
        searching={searchable && open}
        search={
          searchable && (
            <SearchControl
              label="Search chats"
              query={query}
              onQuery={setQuery}
              open={open}
              onOpen={setOpen}
              // The field runs the width of the row rather than to a set
              // number, which is what the head gave up its heading for.
              wide
            />
          )
        }
      />

      {searchable ? <GroupChats chats={chats} query={query} /> : children}
    </>
  );
}
