import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  Download,
  FolderOpen,
  Square,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  Button,
  Dialog,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
} from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import { HostClientProblem, importLimits } from '../../host_client/index.ts';
import type {
  ImportPreview,
  ImportPublication,
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import { inventoryFolderGroups } from './inventory-folder-presentation.ts';
import { ErrorNotice } from './error-notice.tsx';
import styles from './import-dialog.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
type Candidate = ImportPreview['candidates'][number];
type NameChecks = Awaited<
  ReturnType<PlysmithApplicationStore['checkImportNames']>
>;

export function ImportDialog({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const dialog = useRef<HTMLElement>(null);
  const session = state.importSession;
  const busy = state.busyCommand !== undefined || state.refreshing;
  const preparing = session?.activity === 'preparing';
  const dismissalBlocked = busy && !preparing;
  const message = (id: string) => intl.formatMessage({ id });
  useEffect(() => {
    if (
      !busy &&
      session?.open &&
      dialog.current !== null &&
      !dialog.current.contains(document.activeElement)
    )
      dialog.current.focus();
  }, [busy, session?.open]);
  if (session === undefined) return null;
  return (
    <ModalOverlay
      className={styles.overlay!}
      isOpen={session.open}
      isDismissable={!dismissalBlocked}
      isKeyboardDismissDisabled={dismissalBlocked}
      onOpenChange={(open) => {
        if (!open) void store.closeImport();
      }}
    >
      <Modal className={styles.modal!}>
        <Dialog
          ref={dialog}
          className={styles.dialog!}
          aria-labelledby="import-title"
        >
          <header className={styles.header}>
            <h2 id="import-title">
              <FormattedMessage id="import.title" />
            </h2>
            <button
              type="button"
              className={styles.iconButton!}
              aria-label={message('import.close')}
              title={message('import.close')}
              disabled={dismissalBlocked}
              onClick={() => void store.closeImport()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className={styles.body}>
            {session.errorCode !== undefined && (
              <ImportProblem code={session.errorCode} />
            )}
            <div className={styles.toolbar}>
              <Button
                className={styles.button!}
                isDisabled={busy}
                onPress={() => void store.chooseImportFile()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                <FormattedMessage id="import.choose" />
              </Button>
              {session.activity !== undefined && (
                <span role="status">
                  <FormattedMessage id={'import.' + session.activity} />
                </span>
              )}
            </div>
            {session.completedCount !== undefined && (
              <p role="status" className={styles.success}>
                <Check size={18} aria-hidden="true" />
                <FormattedMessage
                  id="import.published"
                  values={{ count: session.completedCount }}
                />
              </p>
            )}
            {session.errorCode === 'import.encoding_choice_required' &&
              session.input !== undefined && (
                <Button
                  className={styles.button!}
                  isDisabled={busy}
                  onPress={() => void store.retryImportAsLatin1()}
                >
                  <FormattedMessage id="import.latin1" />
                </Button>
              )}
            {session.preview !== undefined && (
              <ImportPreviewForm
                key={session.preview.previewId}
                state={state}
                store={store}
                preview={session.preview}
                busy={busy}
              />
            )}
          </div>
          {session.preview === undefined && (
            <footer className={styles.footer}>
              <Button
                className={styles.button!}
                isDisabled={dismissalBlocked}
                onPress={() => void store.closeImport()}
              >
                <FormattedMessage
                  id={preparing ? 'import.cancel' : 'import.close'}
                />
              </Button>
            </footer>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function ImportPreviewForm({
  state,
  store,
  preview,
  busy,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly preview: ImportPreview;
  readonly busy: boolean;
}) {
  const intl = useIntl();
  const message = (id: string) => intl.formatMessage({ id });
  const rootFolder = state.inventoryOrganization.folders.find(
    (folder) =>
      folder.parentFolderId === undefined &&
      folder.displayName === preview.sourceDisplayName,
  );
  const [folderChoice, setFolderChoice] = useState(
    rootFolder?.folderId ?? 'new',
  );
  const [folderName, setFolderName] = useState(preview.sourceDisplayName);
  const [prefix, setPrefix] = useState(preview.sourceDisplayName + ' - ');
  const prefixInput = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const available = preview.candidates.filter(
    (candidate) => candidate.status !== 'rejected',
  );
  const allFit =
    available.length <= importLimits.maxPublishedCandidates &&
    available.reduce((total, candidate) => total + candidate.moveCount, 0) <=
      importLimits.maxPublicationNodes;
  const [selected, setSelected] = useState(
    () => new Set(allFit ? available.map((c) => c.sourceOrder) : []),
  );
  const [types, setTypes] = useState<Record<number, 'analysis' | 'game'>>({});
  const [offset, setOffset] = useState(0);
  const [confirmedWarningKey, setConfirmedWarningKey] = useState('');
  const [checks, setChecks] = useState<{
    readonly key: string;
    readonly result?: NameChecks;
    readonly errorCode?: string;
  }>();
  const selectedCandidates = available.filter((c) =>
    selected.has(c.sourceOrder),
  );
  const selectedNodes = selectedCandidates.reduce(
    (total, candidate) => total + candidate.moveCount,
    0,
  );
  const selectionFits =
    selectedCandidates.length <= importLimits.maxPublishedCandidates &&
    selectedNodes <= importLimits.maxPublicationNodes;
  const selections = selectedCandidates.map((c) => ({
    sourceOrder: c.sourceOrder,
    itemType: types[c.sourceOrder] ?? ('analysis' as const),
    displayName: (prefix + (names[c.sourceOrder] ?? c.suggestedName)).trim(),
  }));
  const validNames = selections.every(
    (c) => c.displayName.length > 0 && c.displayName.length <= 160,
  );
  const namesKey = JSON.stringify(
    selections.map(({ sourceOrder, displayName }) => ({
      sourceOrder,
      displayName,
    })),
  );
  const validationKey =
    namesKey +
    ':' +
    state.status.persistence.dataRevision +
    ':' +
    (state.importSession?.errorCode ?? '');
  const checked = selections.length === 0 || checks?.key === validationKey;
  const conflicts = checked
    ? (checks?.result?.candidates.filter((c) => !c.available) ?? [])
    : [];
  const normalizedPrefix = prefix.trimStart();
  const proposalsFit = conflicts.every((candidate) =>
    candidate.suggestedDisplayName.startsWith(normalizedPrefix),
  );
  const warningCandidates = preview.candidates.filter(
    (c) =>
      selected.has(c.sourceOrder) &&
      (c.status === 'warning' ||
        c.findings.some((f) => f.severity === 'warning')),
  );
  const warningKey = JSON.stringify(
    warningCandidates.map((c) => c.sourceOrder),
  );
  const warningsConfirmed =
    warningCandidates.length === 0 || confirmedWarningKey === warningKey;
  const validFolder =
    folderChoice !== 'new' ||
    (folderName.trim().length > 0 && folderName.trim().length <= 160);
  const canPublish =
    !busy &&
    selectionFits &&
    validFolder &&
    validNames &&
    checked &&
    checks?.errorCode === undefined &&
    conflicts.length === 0 &&
    selections.length > 0 &&
    warningsConfirmed;
  const folderGroups = inventoryFolderGroups(
    state.inventoryOrganization,
    [],
    false,
    intl.locale,
  );
  const visible = preview.candidates.slice(offset, offset + 100);

  useEffect(() => {
    if (!selectionFits || !validNames || selections.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void store
        .checkImportNames(
          JSON.parse(namesKey) as Parameters<
            PlysmithApplicationStore['checkImportNames']
          >[0],
        )
        .then((result) => {
          if (!cancelled) setChecks({ key: validationKey, result });
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setChecks({
              key: validationKey,
              errorCode:
                error instanceof HostClientProblem
                  ? error.problem.code
                  : 'host.unavailable',
            });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    namesKey,
    validationKey,
    validNames,
    selectionFits,
    selections.length,
    store,
  ]);

  function changeSelection(candidate: Candidate, included: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (included) next.add(candidate.sourceOrder);
      else next.delete(candidate.sourceOrder);
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPublish) return;
    const folder: ImportPublication['folder'] =
      folderChoice === 'new'
        ? { kind: 'new', displayName: folderName.trim() }
        : folderChoice === ''
          ? { kind: 'unfiled' }
          : { kind: 'existing', folderId: folderChoice };
    await store.publishImport({
      candidates: selections,
      folder,
      confirmWarnings: warningsConfirmed,
    });
  }

  return (
    <form id="import-selection" onSubmit={(event) => void submit(event)}>
      <section className={styles.file} aria-label={message('import.file')}>
        <strong>{preview.sourceDisplayName}</strong>
        <span>
          {intl.formatNumber(preview.inputSize)} B · {preview.encoding}
        </span>
      </section>
      <div className={styles.destination}>
        <label>
          <span>
            <FormattedMessage id="import.folder" />
          </span>
          <select
            aria-label={message('import.folder')}
            value={folderChoice}
            disabled={busy}
            onChange={(event) => setFolderChoice(event.target.value)}
          >
            <option value="new">{message('import.newFolder')}</option>
            <option value="">{message('folders.unfiled')}</option>
            {folderGroups
              .filter((folder) => folder.folderId !== undefined)
              .map((folder) => (
                <option value={folder.folderId} key={folder.folderId}>
                  {folder.path}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>
            <FormattedMessage id="import.prefix" />
          </span>
          <input
            aria-label={message('import.prefix')}
            ref={prefixInput}
            value={prefix}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </label>
        {folderChoice === 'new' && (
          <label>
            <span>
              <FormattedMessage id="import.folderName" />
            </span>
            <input
              aria-label={message('import.folderName')}
              value={folderName}
              maxLength={160}
              disabled={busy}
              onChange={(event) => setFolderName(event.target.value)}
            />
          </label>
        )}
      </div>
      <p className={styles.summary} role="status">
        <FormattedMessage
          id="import.counts"
          values={{
            selected: selections.length,
            total: preview.candidates.length,
            conflicts: conflicts.length,
            warnings: warningCandidates.length,
          }}
        />
        {!checked && validNames && selectionFits && (
          <span>
            {' '}
            · <FormattedMessage id="import.checkingNames" />
          </span>
        )}
      </p>
      <p id="import-selected-moves" className={styles.summary} role="status">
        <FormattedMessage
          id="import.selectedMoves"
          values={{ moves: selectedNodes }}
        />
      </p>
      {(!selectionFits || (!allFit && selections.length === 0)) && (
        <p
          className={selectionFits ? styles.summary : styles.problem}
          role="status"
        >
          <FormattedMessage
            id={
              selectionFits
                ? 'import.selectWithinBudget'
                : 'import.selectionOverBudget'
            }
          />
        </p>
      )}
      {checks?.key === validationKey && checks.errorCode !== undefined && (
        <ImportProblem code={checks.errorCode} />
      )}
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.iconButton!}
          aria-label={message('import.selectAll')}
          title={message('import.selectAll')}
          disabled={busy}
          onClick={() =>
            setSelected(
              new Set(
                preview.candidates
                  .filter((c) => c.status !== 'rejected')
                  .map((c) => c.sourceOrder),
              ),
            )
          }
        >
          <CheckSquare size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.iconButton!}
          aria-label={message('import.clearSelection')}
          title={message('import.clearSelection')}
          disabled={busy}
          onClick={() => setSelected(new Set())}
        >
          <Square size={18} aria-hidden="true" />
        </button>
        <span>
          <FormattedMessage id="import.bulkType" />
        </span>
        <TypeSelection
          label={message('import.bulkType')}
          disabled={busy}
          onChange={(type) =>
            setTypes(
              Object.fromEntries(
                preview.candidates.map((c) => [c.sourceOrder, type]),
              ),
            )
          }
        />
        <Button
          className={styles.button!}
          isDisabled={busy || conflicts.length === 0 || !proposalsFit}
          onPress={() => {
            setNames((current) => {
              const next = { ...current };
              for (const conflict of conflicts) {
                next[conflict.sourceOrder] =
                  conflict.suggestedDisplayName.slice(normalizedPrefix.length);
              }
              return next;
            });
            prefixInput.current?.focus();
          }}
        >
          <WandSparkles size={16} aria-hidden="true" />
          <FormattedMessage id="import.names" />
        </Button>
      </div>
      {!proposalsFit && (
        <p className={styles.problem}>
          <FormattedMessage id="import.shortenPrefix" />
        </p>
      )}
      <ol className={styles.candidates} start={offset + 1}>
        {visible.map((candidate) => {
          const title = names[candidate.sourceOrder] ?? candidate.suggestedName;
          const fullName = (prefix + title).trim();
          const conflict = conflicts.find(
            (c) => c.sourceOrder === candidate.sourceOrder,
          );
          const invalidName =
            selected.has(candidate.sourceOrder) &&
            (fullName.length === 0 || fullName.length > 160);
          return (
            <li className={styles.candidate} key={candidate.sourceOrder}>
              <div className={styles.candidateMain}>
                <input
                  type="checkbox"
                  aria-label={intl.formatMessage(
                    { id: 'import.select' },
                    { name: fullName },
                  )}
                  checked={selected.has(candidate.sourceOrder)}
                  disabled={busy || candidate.status === 'rejected'}
                  onChange={(event) =>
                    changeSelection(candidate, event.target.checked)
                  }
                />
                <span className={styles.order}>
                  {candidate.sourceOrder + 1}
                </span>
                <label className={styles.name}>
                  <span className={styles.srOnly}>
                    <FormattedMessage id="import.name" />
                  </span>
                  {prefix !== '' && (
                    <span className={styles.prefix}>{prefix}</span>
                  )}
                  <input
                    value={title}
                    maxLength={160}
                    aria-label={
                      message('import.name') + ' ' + (candidate.sourceOrder + 1)
                    }
                    disabled={busy || candidate.status === 'rejected'}
                    aria-invalid={invalidName || conflict !== undefined}
                    onChange={(event) =>
                      setNames((current) => ({
                        ...current,
                        [candidate.sourceOrder]: event.target.value,
                      }))
                    }
                  />
                </label>
                <TypeSelection
                  label={
                    message('import.type') + ' ' + (candidate.sourceOrder + 1)
                  }
                  value={types[candidate.sourceOrder] ?? 'analysis'}
                  disabled={busy || candidate.status === 'rejected'}
                  onChange={(type) =>
                    setTypes((current) => ({
                      ...current,
                      [candidate.sourceOrder]: type,
                    }))
                  }
                />
                <span
                  className={
                    candidate.status === 'rejected'
                      ? styles.rejected
                      : candidate.status === 'warning'
                        ? styles.warning
                        : styles.status
                  }
                >
                  <FormattedMessage id={'import.' + candidate.status} />
                </span>
              </div>
              <div className={styles.candidateDetail}>
                <span>
                  <FormattedMessage
                    id="import.moves"
                    values={{
                      moves: candidate.moveCount,
                      variations: candidate.variationCount,
                    }}
                  />
                </span>
                {invalidName && (
                  <span className={styles.rejected}>
                    <FormattedMessage id="import.nameLength" />
                  </span>
                )}
                {conflict !== undefined && (
                  <span className={styles.rejected}>
                    <FormattedMessage id="import.conflict" /> ·{' '}
                    <FormattedMessage
                      id="import.suggestion"
                      values={{ name: conflict.suggestedDisplayName }}
                    />
                  </span>
                )}
                {candidate.rootFen !== undefined && (
                  <code className={styles.fen}>{candidate.rootFen}</code>
                )}
                {candidate.findings.length > 0 && (
                  <details>
                    <summary>
                      <FormattedMessage
                        id="import.findings"
                        values={{ count: candidate.findings.length }}
                      />
                    </summary>
                    <ul className={styles.findings}>
                      {candidate.findings.map((finding, index) => (
                        <li key={index}>
                          <strong>
                            <FormattedMessage
                              id={'import.' + finding.disposition}
                            />
                          </strong>
                          {' · '}
                          <FormattedMessage
                            id={'import.severity.' + finding.severity}
                          />
                          {' · '}
                          <ImportFinding code={finding.code} />
                          {finding.nodeIndex !== undefined && (
                            <>
                              {' '}
                              ·{' '}
                              <FormattedMessage
                                id="import.node"
                                values={{ index: finding.nodeIndex + 1 }}
                              />
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {preview.candidates.length > 100 && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.iconButton!}
            aria-label={message('import.previous')}
            title={message('import.previous')}
            disabled={busy || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <span>
            <FormattedMessage
              id="import.page"
              values={{
                from: offset + 1,
                to: Math.min(offset + 100, preview.candidates.length),
                total: preview.candidates.length,
              }}
            />
          </span>
          <button
            type="button"
            className={styles.iconButton!}
            aria-label={message('import.next')}
            title={message('import.next')}
            disabled={busy || offset + 100 >= preview.candidates.length}
            onClick={() => setOffset(offset + 100)}
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      {warningCandidates.length > 0 && (
        <label className={styles.confirmWarning}>
          <input
            type="checkbox"
            checked={warningsConfirmed}
            disabled={busy}
            onChange={(event) =>
              setConfirmedWarningKey(event.target.checked ? warningKey : '')
            }
          />
          <FormattedMessage id="import.confirmWarnings" />
        </label>
      )}
      <footer className={styles.footer}>
        <Button
          className={styles.button!}
          isDisabled={busy}
          onPress={() => void store.closeImport()}
        >
          <FormattedMessage id="import.cancel" />
        </Button>
        <button
          type="submit"
          className={styles.primary!}
          aria-describedby="import-selected-moves"
          disabled={!canPublish}
        >
          <Download size={16} aria-hidden="true" />
          <FormattedMessage id="import.publish" />
        </button>
      </footer>
    </form>
  );
}

function TypeSelection({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value?: 'analysis' | 'game';
  readonly disabled: boolean;
  readonly onChange: (type: 'analysis' | 'game') => void;
}) {
  return (
    <RadioGroup
      aria-label={label}
      orientation="horizontal"
      className={styles.types!}
      value={value ?? ''}
      isDisabled={disabled}
      onChange={(next) => {
        if (next === 'analysis' || next === 'game') onChange(next);
      }}
    >
      <Radio value="analysis" className={styles.type!}>
        <FormattedMessage id="itemType.analysis" />
      </Radio>
      <Radio value="game" className={styles.type!}>
        <FormattedMessage id="itemType.game" />
      </Radio>
    </RadioGroup>
  );
}

function ImportFinding({ code }: { readonly code: string }) {
  const intl = useIntl();
  const id = 'import.' + code.replace(/^inventory\.|^import\./, '');
  return intl.messages[id] === undefined ? (
    <code>{code}</code>
  ) : (
    <FormattedMessage id={id} />
  );
}
function ImportProblem({ code }: { readonly code: string }) {
  const intl = useIntl();
  const id = 'import.' + code.replace(/^inventory\.|^import\./, '');
  return intl.messages[id] === undefined ? (
    <ErrorNotice errorCode={code} className={styles.problem} />
  ) : (
    <p className={styles.problem} role="alert">
      <FormattedMessage id={id} />
    </p>
  );
}
