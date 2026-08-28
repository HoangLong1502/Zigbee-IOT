import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Radio, ShieldCheck, X } from 'lucide-react';
import { coordinatorApi, apiErrorMessage } from '@/lib/api';
import { realtime } from '@/lib/realtime';
import { WS_EVENTS } from '@/lib/ws-events';
import { formatRelative, linkQualityInfo } from '@/lib/utils';
import { Badge, Spinner } from '@/components/ui/Card';
import type { PairingPrompt } from '@/types';

type PairingDecision = PairingPrompt & { decision?: 'accept' | 'reject' | 'left' };

/**
 * Global overlay: when a Zigbee device joins within radio range of the
 * coordinator, ask whether to keep it on the network.
 */
export function PairingPromptModal() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: prompts = [] } = useQuery({
    queryKey: ['pairing-prompts'],
    queryFn: async () => {
      try {
        return await coordinatorApi.pairingPrompts();
      } catch {
        return [] as PairingPrompt[];
      }
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const upsert = (payload: unknown) => {
      const prompt = payload as PairingPrompt;
      if (!prompt?.ieeeAddress) return;
      queryClient.setQueryData<PairingPrompt[]>(['pairing-prompts'], (current = []) => {
        const key = prompt.ieeeAddress.toLowerCase();
        const without = current.filter((item) => item.ieeeAddress.toLowerCase() !== key);
        return [...without, prompt];
      });
      notifyPairing(prompt);
    };

    const resolve = (payload: unknown) => {
      const resolved = payload as PairingDecision;
      if (!resolved?.ieeeAddress) return;
      const key = resolved.ieeeAddress.toLowerCase();
      queryClient.setQueryData<PairingPrompt[]>(['pairing-prompts'], (current = []) =>
        current.filter((item) => item.ieeeAddress.toLowerCase() !== key),
      );
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['discovery'] });
    };

    const offPrompt = realtime.on(WS_EVENTS.PAIRING_PROMPT, upsert);
    const offResolved = realtime.on(WS_EVENTS.PAIRING_RESOLVED, resolve);
    return () => {
      offPrompt();
      offResolved();
    };
  }, [queryClient]);

  const current = prompts[0];
  const remaining = Math.max(0, prompts.length - 1);

  const accept = useMutation({
    mutationFn: (ieee: string) => coordinatorApi.acceptPairing(ieee),
    onMutate: () => setError(null),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const reject = useMutation({
    mutationFn: (ieee: string) => coordinatorApi.rejectPairing(ieee),
    onMutate: () => setError(null),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const busy = accept.isPending || reject.isPending;

  const onAccept = useCallback(() => {
    if (current) accept.mutate(current.ieeeAddress);
  }, [accept, current]);

  const onReject = useCallback(() => {
    if (current) reject.mutate(current.ieeeAddress);
  }, [reject, current]);

  const identity = useMemo(() => {
    if (!current) return '';
    const parts = [current.manufacturer, current.model].filter(Boolean);
    return parts.join(' · ') || 'Interviewing device…';
  }, [current]);

  if (!current) return null;

  const lqi = linkQualityInfo(current.linkQuality);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="pairing-prompt-title"
        className="card w-full max-w-md p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/20 text-accent-soft">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p id="pairing-prompt-title" className="text-base font-semibold text-white">
                Nearby Zigbee device
              </p>
              <p className="text-xs text-slate-400">
                Pair it with this coordinator?
                {remaining > 0 ? ` · ${remaining} more waiting` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"
            aria-label="Ask again later"
            disabled={busy}
            onClick={() =>
              queryClient.setQueryData<PairingPrompt[]>(['pairing-prompts'], (currentList = []) => {
                if (currentList.length <= 1) return currentList;
                const [first, ...rest] = currentList;
                return [...rest, first];
              })
            }
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/5">
            {current.imageUrl ? (
              <img src={current.imageUrl} alt="" className="h-full w-full object-contain p-1" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-500">
                Zigbee
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-100">{current.friendlyName}</p>
            <p className="truncate text-sm text-slate-400">{identity}</p>
            {current.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{current.description}</p>
            ) : null}
            <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{current.ieeeAddress}</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {current.nearCoordinator ? (
            <Badge tone="success">Near coordinator</Badge>
          ) : (
            <Badge>In radio range</Badge>
          )}
          <Badge tone={current.interviewStatus === 'successful' ? 'success' : 'warning'}>
            Interview {current.interviewStatus ?? 'pending'}
          </Badge>
          <Badge>
            <span className={lqi.color}>LQI {current.linkQuality ?? '—'}</span>
          </Badge>
          <Badge>Seen {formatRelative(current.joinedAt)}</Badge>
        </div>

        <p className="mb-4 text-sm text-slate-400">
          Put the device next to the USB coordinator and into pairing mode. Pair keeps it on the
          network. Don&apos;t pair removes it immediately.
        </p>

        {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={onReject}
          >
            {reject.isPending ? <Spinner /> : <X className="h-4 w-4" />}
            Don&apos;t pair
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={onAccept}>
            {accept.isPending ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
            Pair
          </button>
        </div>
      </div>
    </div>
  );
}

function notifyPairing(prompt: PairingPrompt): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') void Notification.requestPermission();
  if (Notification.permission !== 'granted') return;
  try {
    const label = [prompt.manufacturer, prompt.model].filter(Boolean).join(' ') || prompt.friendlyName;
    new Notification('Zigbee device nearby', {
      body: `Pair ${label}?`,
      tag: `pair-${prompt.ieeeAddress}`,
    });
  } catch {
    // Some browsers block Notification construction outside a user gesture.
  }
}
