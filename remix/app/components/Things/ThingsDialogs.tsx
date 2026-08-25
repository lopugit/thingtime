import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  Box,
  Button,
  Checkbox,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Text
} from '@chakra-ui/react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { RenderThing } from '~/components/Kinds';
import { ThingView } from '~/components/Thingtime/ThingView';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

import { FolderTree } from './FolderTree';
import type { FolderTreeProps } from './FolderTree';
import {
  VISIBILITY_META,
  circleOf,
  composeAcl,
  formatWhen,
  isFolder,
  personGrantsOf,
  primaryKindOf,
  thingDisplayName,
  thingIcon,
  thingLink
} from './thingsCore';
import type { ThingsThing } from './thingsCore';

const modalCard = {
  background: 'var(--tt-card, #ffffff)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-lg, 16px)'
} as const;

// ---------------------------------------------------------------------------
// New folder

export const NewFolderDialog = ({
  isOpen,
  onClose,
  onCreate
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => Promise<boolean>;
}) => {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setIcon('');
      setBusy(false);
    }
  }, [isOpen]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await onCreate(name.trim(), icon.trim());
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal initialFocusRef={inputRef} isOpen={isOpen} onClose={onClose} size="sm">
      <ModalOverlay />
      <ModalContent {...modalCard}>
        <ModalHeader fontSize="16px">New folder 📁</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Flex direction="column" gap={3}>
            <Input
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
              placeholder="Folder name"
              ref={inputRef}
              value={name}
            />
            <Input
              maxWidth="140px"
              onChange={(event) => setIcon(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
              placeholder="Icon (emoji)"
              value={icon}
            />
          </Flex>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button onClick={onClose} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button colorScheme="pink" isDisabled={!name.trim()} isLoading={busy} onClick={submit} size="sm">
            Create
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Rename (folders / data / schema things — kinds whose crystal carries a name)

export const RenameDialog = ({
  thing,
  onClose,
  onRename
}: {
  thing: ThingsThing | null;
  onClose: () => void;
  onRename: (thing: ThingsThing, name: string) => Promise<boolean>;
}) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (thing) {
      setName(typeof thing.crystal?.name === 'string' ? thing.crystal.name : thingDisplayName(thing));
      setBusy(false);
    }
  }, [thing]);

  const submit = async () => {
    if (!thing || !name.trim() || busy) return;
    setBusy(true);
    const ok = await onRename(thing, name.trim());
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal initialFocusRef={inputRef} isOpen={!!thing} onClose={onClose} size="sm">
      <ModalOverlay />
      <ModalContent {...modalCard}>
        <ModalHeader fontSize="16px">Rename ✏️</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Input
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            ref={inputRef}
            value={name}
          />
        </ModalBody>
        <ModalFooter gap={2}>
          <Button onClick={onClose} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button colorScheme="pink" isDisabled={!name.trim()} isLoading={busy} onClick={submit} size="sm">
            Rename
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Move to… — folder picker over the same tree the sidebar uses

export const MoveDialog = ({
  isOpen,
  count,
  treeProps,
  onClose,
  onMove
}: {
  isOpen: boolean;
  count: number;
  treeProps: Omit<FolderTreeProps, 'currentFolderId' | 'onPick'>;
  onClose: () => void;
  onMove: (folderId: string | null) => Promise<boolean>;
}) => {
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedRoot, setPickedRoot] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPicked(null);
      setPickedRoot(false);
      setBusy(false);
    }
  }, [isOpen]);

  const submit = async () => {
    if (busy || (!picked && !pickedRoot)) return;
    setBusy(true);
    const ok = await onMove(picked);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalOverlay />
      <ModalContent {...modalCard}>
        <ModalHeader fontSize="16px">Move {count === 1 ? '1 thing' : `${count} things`} to… 📁</ModalHeader>
        <ModalCloseButton />
        <ModalBody maxHeight="50vh" overflowY="auto">
          <FolderTree
            {...treeProps}
            currentFolderId={pickedRoot ? null : picked}
            onPick={(folderId) => {
              setPicked(folderId);
              setPickedRoot(folderId === null);
            }}
            rootLabel="Root (no folder)"
          />
        </ModalBody>
        <ModalFooter gap={2}>
          <Button onClick={onClose} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button colorScheme="pink" isDisabled={!picked && !pickedRoot} isLoading={busy} onClick={submit} size="sm">
            Move here
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Share — audience circle + per-person grants + copy link. Applies the same
// audience to every selected thing (attached things that inherit their
// target's audience are skipped with an honest per-item error). Folders can
// opt into flowing the audience to everything inside (recursive bulk share).

export const ShareDialog = ({
  things,
  onClose,
  onApply
}: {
  things: ThingsThing[];
  onClose: () => void;
  onApply: (acl: string[], recursive: boolean) => Promise<boolean>;
}) => {
  const api = useApi();
  const lopu = useLopu();
  const apiRef = useRef(api);
  apiRef.current = api;

  const single = things.length === 1 ? things[0] : null;
  const folderCount = things.filter(isFolder).length;
  const [circle, setCircle] = useState('private');
  const [people, setPeople] = useState<string[]>([]);
  const [peopleLabels, setPeopleLabels] = useState<Record<string, string>>({});
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<
    Array<{ username: string; displayName: string | null; temporary?: boolean }>
  >([]);
  const [recursive, setRecursive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!things.length) return;
    const first = things[0];
    const initial = circleOf(first.acl);
    setCircle(initial === 'inherit' ? 'private' : initial);
    setPeople(single ? personGrantsOf(first.acl) : []);
    setPeopleLabels({});
    setPersonQuery('');
    setPersonResults([]);
    setRecursive(false);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [things.map((thing) => thing.id).join(',')]);

  // debounced people search
  useEffect(() => {
    const q = personQuery.trim();
    if (!q) {
      setPersonResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const resp = await apiRef.current.v1.profile.search({ q, limit: 6 });
        if (!cancelled) setPersonResults(resp?.users || []);
      } catch {
        if (!cancelled) setPersonResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [personQuery]);

  const inheritLocked = useMemo(() => things.filter((thing) => thing.acl.includes('tt:inherit')), [things]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onApply(composeAcl(circle, people), recursive && folderCount > 0);
    setBusy(false);
    if (ok) onClose();
  };

  const copyLink = async () => {
    if (!single) return;
    const url = `${window.location.origin}${thingLink(single)}`;
    try {
      await navigator.clipboard.writeText(url);
      lopu({ title: 'Link copied 🔗', description: url, status: 'success', duration: 6000 });
    } catch {
      lopu({ title: 'Couldn’t copy the link', description: url, status: 'error' });
    }
  };

  return (
    <Modal isOpen={!!things.length} onClose={onClose} size="md">
      <ModalOverlay />
      <ModalContent {...modalCard}>
        <ModalHeader fontSize="16px">
          Share {single ? `“${thingDisplayName(single)}”` : `${things.length} things`} 🌐
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Flex direction="column" gap={4}>
            <Box>
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" marginBottom={1}>
                Audience
              </Text>
              <Select onChange={(event) => setCircle(event.target.value)} size="sm" value={circle}>
                {['public', 'friends', 'family', 'private'].map((value) => (
                  <option key={value} value={value}>
                    {VISIBILITY_META[value].icon} {VISIBILITY_META[value].label}
                  </option>
                ))}
              </Select>
            </Box>
            <Box>
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" marginBottom={1}>
                Share with specific people
              </Text>
              <Input
                onChange={(event) => setPersonQuery(event.target.value)}
                placeholder="Search people by name…"
                size="sm"
                value={personQuery}
              />
              {personResults.length > 0 && (
                <Box border="1px solid var(--tt-border, #ececef)" borderRadius="10px" marginTop={1} overflow="hidden">
                  {personResults.map((person) => (
                    <Flex
                      key={person.username}
                      _hover={{ background: 'var(--tt-surface, #fafafb)' }}
                      cursor="pointer"
                      gap={2}
                      onClick={() => {
                        setPeople((prev) => (prev.includes(person.username) ? prev : [...prev, person.username]));
                        setPeopleLabels((prev) => ({ ...prev, [person.username]: getUserIdentityDetail(person) }));
                        setPersonQuery('');
                        setPersonResults([]);
                      }}
                      paddingX={3}
                      paddingY={2}
                    >
                      <Text fontSize="13px" fontWeight={500}>
                        {getUserDisplayName(person)}
                      </Text>
                      <Text color="var(--tt-muted, #9a9aa6)" fontSize="13px">
                        {getUserIdentityDetail(person)}
                      </Text>
                    </Flex>
                  ))}
                </Box>
              )}
              <Flex flexWrap="wrap" gap={2} marginTop={2}>
                {people.map((username) => (
                  <Flex
                    key={username}
                    alignItems="center"
                    background="var(--tt-surface, #fafafb)"
                    border="1px solid var(--tt-border, #ececef)"
                    borderRadius="999px"
                    gap={1}
                    paddingX={2}
                    paddingY="2px"
                  >
                    <Text fontSize="12px">{peopleLabels[username] || `@${username}`}</Text>
                    <Box
                      as="button"
                      color="var(--tt-muted, #9a9aa6)"
                      fontSize="12px"
                      onClick={() => setPeople((prev) => prev.filter((entry) => entry !== username))}
                      type="button"
                    >
                      ✕
                    </Box>
                  </Flex>
                ))}
                {!people.length && (
                  <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px">
                    No direct grants — the audience circle decides who sees {things.length === 1 ? 'it' : 'them'}.
                  </Text>
                )}
              </Flex>
            </Box>
            {folderCount > 0 && (
              <Box>
                <Checkbox
                  colorScheme="pink"
                  isChecked={recursive}
                  onChange={(event) => setRecursive(event.target.checked)}
                  size="sm"
                >
                  <Text fontSize="13px">
                    📂 Also apply to everything inside {folderCount === 1 ? 'the folder' : `the ${folderCount} folders`}
                  </Text>
                </Checkbox>
                <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" marginLeft="24px">
                  Every thing in the {folderCount === 1 ? 'folder' : 'folders'} (subfolders included) takes this audience.
                  Attached things that inherit their target’s audience are skipped.
                </Text>
              </Box>
            )}
            {inheritLocked.length > 0 && (
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px">
                ⚠️ {inheritLocked.length === 1 ? '1 selected thing inherits' : `${inheritLocked.length} selected things inherit`}{' '}
                the audience of what {inheritLocked.length === 1 ? 'it is' : 'they are'} attached to and will be skipped.
              </Text>
            )}
          </Flex>
        </ModalBody>
        <ModalFooter gap={2}>
          {single && (
            <Button marginRight="auto" onClick={copyLink} size="sm" variant="outline">
              🔗 Copy link
            </Button>
          )}
          <Button onClick={onClose} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button colorScheme="pink" isLoading={busy} onClick={submit} size="sm">
            Apply
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Delete confirmation — deletion is permanent (no trash), so it is explicit
// about the cascade and the folder re-parenting rule.

export const DeleteConfirmDialog = ({
  things,
  onClose,
  onConfirm
}: {
  things: ThingsThing[];
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
}) => {
  const [busy, setBusy] = useState(false);
  const folders = things.filter(isFolder).length;

  useEffect(() => {
    if (things.length) setBusy(false);
  }, [things.length]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onConfirm();
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal isOpen={!!things.length} onClose={onClose} size="sm">
      <ModalOverlay />
      <ModalContent {...modalCard}>
        <ModalHeader fontSize="16px">Delete {things.length === 1 ? '1 thing' : `${things.length} things`}? 🗑️</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Flex direction="column" gap={2}>
            <Text fontSize="13px">
              This can’t be undone. Comments, reactions, and saves attached to {things.length === 1 ? 'it' : 'them'} are
              deleted too.
            </Text>
            {folders > 0 && (
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="13px">
                📁 {folders === 1 ? 'The folder’s contents are' : `The ${folders} folders’ contents are`} NOT deleted —
                they move up into the parent folder.
              </Text>
            )}
          </Flex>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button onClick={onClose} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button colorScheme="red" isLoading={busy} onClick={submit} size="sm">
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Preview — renders a non-post thing via the kind system (posts open their own
// /post/:id page instead). Deep-linkable as /things?preview=<id>.

export const PreviewModal = ({
  thing,
  onClose,
  onAction
}: {
  thing: ThingsThing | null;
  onClose: () => void;
  onAction: (thing: ThingsThing, action: 'rename' | 'move' | 'share' | 'delete') => void;
}) => {
  const viewer = useCurrentUser();
  // Ownership IS the trust boundary for the interactive render below. This
  // modal opens on ANY thing the viewer can read — the ?preview=<id> deep link
  // resolves foreign public things too — so a component authored by someone
  // else must render INERT here, exactly like the feed/search surfaces. The
  // check lives inside the modal rather than at the call site so a future
  // caller cannot forget it.
  const untrusted = !!thing && (!viewer?.id || thing.author?.id !== viewer.id);
  return (
  <Modal isOpen={!!thing} onClose={onClose} size="lg">
    <ModalOverlay />
    {thing && (
      <ModalContent {...modalCard}>
        <ModalHeader fontSize="16px">
          {thingIcon(thing)} {thingDisplayName(thing)}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Flex direction="column" gap={3}>
            <Flex color="var(--tt-muted, #9a9aa6)" flexWrap="wrap" fontSize="12px" gap={3}>
              <Text>{primaryKindOf(thing)}</Text>
              <Text>
                {(VISIBILITY_META[thing.visibility] || VISIBILITY_META.private).icon}{' '}
                {(VISIBILITY_META[thing.visibility] || VISIBILITY_META.private).label}
              </Text>
              <Text>updated {formatWhen(thing.updatedAt)}</Text>
              {thing.tags.map((tag) => (
                <Text key={tag}>#{tag}</Text>
              ))}
            </Flex>
            <Box border="1px solid var(--tt-border, #ececef)" borderRadius="12px" overflow="hidden" padding={3}>
              {thing.thingtime.includes('component') ? (
                // the interactive surface for component instances: the kind
                // renderer resolves the template AND its ttAction wrapper
                // handles clicks (grid previews stay pointerEvents:none)
                <RenderThing
                  context={{ size: 'full', untrusted }}
                  fallback={<ThingView compact thing={thing.crystal} />}
                  thing={thing as unknown as Record<string, unknown>}
                />
              ) : (
                <ThingView compact thing={thing.crystal} />
              )}
            </Box>
          </Flex>
        </ModalBody>
        <ModalFooter flexWrap="wrap" gap={2}>
          <Button marginRight="auto" onClick={() => onAction(thing, 'delete')} size="sm" variant="ghost">
            🗑️ Delete
          </Button>
          <Button onClick={() => onAction(thing, 'move')} size="sm" variant="outline">
            📁 Move
          </Button>
          <Button onClick={() => onAction(thing, 'share')} size="sm" variant="outline">
            🌐 Share
          </Button>
          <Button colorScheme="pink" onClick={onClose} size="sm">
            Done
          </Button>
        </ModalFooter>
      </ModalContent>
    )}
  </Modal>
  );
};
