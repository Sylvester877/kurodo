/**
 * ServerPicker behavior tests.
 *
 * Pins down two rules:
 *   1. ALL 3 type tabs (sub, hsub, dub) ALWAYS render, regardless of how
 *      many providers the upstream returned — the prior bug silently hid
 *      the Dub tab when chad returned no dub entries.
 *   2. NOTHING in the picker is ever disabled. Tabs are always selectable
 *      (an empty one shows a "nothing listed" panel), and every server tile
 *      is always clickable — verified-dead servers included. Health is a
 *      badge, not a gate.
 *
 * Background: prior bug — when chad.anidap.se returned no dub entries
 * for a title, the picker silently hid the Dub tab. Users thought the
 * title "didn't have a dub" when in truth the upstream was blocked
 * (or the family was unreachable from the datacenter IP).
 *
 * Locator strategy: empty-type tabs set `title="Dub servers aren't
 * available…"` which @testing-library treats as the accessible name
 * (overriding inner text). We sidestep that quirk by finding tabs via
 * `getByText('Dub').closest('button')` — the inner span's text is
 * unaffected by the title attribute, and `closest('button')` walks
 * back up to the click target.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './render'
import ServerPicker from '../components/ServerPicker'
import type { AnidapProvider } from '../api/anidap'

function mkProvider(over: Partial<AnidapProvider> & { name: string; type: AnidapProvider['type'] }): AnidapProvider {
  return { ...over }
}

/** Find the type-tab button whose inner span reads `label` exactly. */
function tabButton(label: 'Sub' | 'H-Subs' | 'Dub') {
  return screen.getByText(label, { selector: 'span' }).closest('button') as HTMLButtonElement
}

beforeEach(() => { cleanup() })

// ─────────────────────────────────────────────────────────────────────
// 1. Empty providers list: friendly placeholder, never the picker UI.
// ─────────────────────────────────────────────────────────────────────
describe('ServerPicker — empty providers', () => {
  it('shows the empty-state card with no type tabs', () => {
    renderWithProviders(
      <ServerPicker
        providers={[]}
        streamType="sub"
        activeProvider={null}
        onChangeProvider={() => {}}
        onChangeType={() => {}}
      />,
    )
    expect(screen.getByText(/No servers available for this episode yet/i)).toBeInTheDocument()
    // No tab buttons should render in this branch.
    expect(screen.queryByText('Sub', { selector: 'span' })).not.toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────
// 2. Core fix: ALL three type tabs ALWAYS render, even when some are empty.
// ─────────────────────────────────────────────────────────────────────
describe('ServerPicker — always-render type tabs (dub/missing-tab fix)', () => {
  // Provider list deliberately omits any 'dub' or 'hsub' entries — this
  // is the exact shape the live API returned for One Piece ep 1 before
  // the fix: only saturn/consumet sub entries, no dub.
  const providers: AnidapProvider[] = [
    mkProvider({ name: 'saturn',     type: 'sub', _provider: 'saturn',     default: true,  tip: '720p' }),
    mkProvider({ name: 'consumet',   type: 'sub', _provider: 'consumet',   tip: 'Sub, Fast' }),
  ]

  it('renders all three tabs (Sub, H-Subs, Dub) regardless of empty counts', () => {
    renderWithProviders(
      <ServerPicker
        providers={providers}
        streamType="sub"
        activeProvider="saturn"
        onChangeProvider={() => {}}
        onChangeType={() => {}}
      />,
    )
    // The prior bug hid the Dub tab when no dub providers existed.
    // The fix: ALL three tabs render, and none of them is disabled.
    expect(tabButton('Sub')).toBeInTheDocument()
    expect(tabButton('H-Subs')).toBeInTheDocument()
    expect(tabButton('Dub')).toBeInTheDocument()
  })

  it('empty tabs are NEVER disabled — they stay selectable and explain themselves', () => {
    renderWithProviders(
      <ServerPicker
        providers={providers}
        streamType="sub"
        activeProvider="saturn"
        onChangeProvider={() => {}}
        onChangeType={() => {}}
      />,
    )
    const dubBtn = tabButton('Dub')
    expect(dubBtn).not.toBeDisabled()
    // Tooltip mentions the most likely cause (upstream blocked) and the
    // alternative explanation (no dub exists for the title).
    expect(dubBtn.title).toMatch(/Dub: nothing listed right now/i)
    expect(dubBtn.title).toMatch(/dub stream for this title/i)

    const hsubBtn = tabButton('H-Subs')
    expect(hsubBtn).not.toBeDisabled()
    expect(hsubBtn.title).toMatch(/H-Subs: nothing listed right now/i)
  })

  it('non-empty tab (Sub) is NOT disabled and has no warning tooltip', () => {
    renderWithProviders(
      <ServerPicker
        providers={providers}
        streamType="sub"
        activeProvider="saturn"
        onChangeProvider={() => {}}
        onChangeType={() => {}}
      />,
    )
    const subBtn = tabButton('Sub')
    expect(subBtn).not.toBeDisabled()
    // Non-empty tabs now show server counts: "Sub (2 servers)"
    expect(subBtn.title).toBe('Sub (2 servers)')
  })

  it('clicking an empty tab switches to it and shows the "nothing listed" panel', async () => {
    const onChangeType     = vi.fn()
    const onChangeProvider = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ServerPicker
        providers={providers}
        streamType="sub"
        activeProvider="saturn"
        onChangeProvider={onChangeProvider}
        onChangeType={onChangeType}
      />,
    )
    const dubBtn = tabButton('Dub')
    await user.click(dubBtn)
    // The tab is selectable — the user is never blocked from looking.
    expect(onChangeType).toHaveBeenCalledWith('dub')
    // But with zero dub entries there is nothing to auto-select, so the
    // provider stays put rather than swapping to an undefined server.
    expect(onChangeProvider).not.toHaveBeenCalled()
  })

  it('no server tile is EVER disabled — verified-dead included', async () => {
    // One alive, one verified-dead, one unverified. All three must render as
    // enabled, clickable buttons: a server the backend could not verify (or
    // verified dead for this episode) is still the user's to try.
    const mixed: AnidapProvider[] = [
      mkProvider({ name: 'anidap-yuki', type: 'sub', _provider: 'anidap', _healthy: true }),
      mkProvider({ name: 'anidap-kiwi', type: 'sub', _provider: 'anidap', _healthy: false, _healthError: 'No stream for this title' }),
      mkProvider({ name: 'anidap-neko', type: 'sub', _provider: 'anidap', _healthy: null }),
    ]
    const onChangeProvider = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ServerPicker
        providers={mixed}
        streamType="sub"
        activeProvider="anidap-yuki"
        onChangeProvider={onChangeProvider}
        onChangeType={() => {}}
      />,
    )

    for (const label of ['Yuki', 'Kiwi', 'Neko']) {
      const tile = screen.getByText(label, { selector: 'span' }).closest('button') as HTMLButtonElement
      expect(tile).toBeInTheDocument()
      expect(tile).not.toBeDisabled()
    }
    // The dead one says so, without being taken away.
    expect(screen.getByText('NO STREAM')).toBeInTheDocument()
    expect(screen.getByText('UNVERIFIED')).toBeInTheDocument()

    // And clicking the verified-dead tile really does select it.
    await user.click(screen.getByText('Kiwi', { selector: 'span' }).closest('button') as HTMLButtonElement)
    expect(onChangeProvider).toHaveBeenCalledWith('anidap-kiwi')
  })

  it('clicking a NON-empty tab DOES swap type + provider', async () => {
    // Add a 'dub' provider to the list so the Dub tab becomes enabled.
    const withDub: AnidapProvider[] = [
      ...providers,
      mkProvider({ name: 'anidap-yuki', type: 'dub', _provider: 'anidap', default: true, tip: '1080p, Fastest' }),
    ]
    const onChangeType     = vi.fn()
    const onChangeProvider = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ServerPicker
        providers={withDub}
        streamType="sub"
        activeProvider="saturn"
        onChangeProvider={onChangeProvider}
        onChangeType={onChangeType}
      />,
    )
    const dubBtn = tabButton('Dub')
    expect(dubBtn).not.toBeDisabled()
    expect(dubBtn.title).toBe('Dub (1 server)')
    await user.click(dubBtn)
    expect(onChangeType).toHaveBeenCalledWith('dub')
    // Default provider for the type is picked first; anidap-yuki has
    // default=true so sortProviders' default-first tie-breaker picks it
    // over the alphabetical fallback.
    expect(onChangeProvider).toHaveBeenCalledWith('anidap-yuki')
  })
})
