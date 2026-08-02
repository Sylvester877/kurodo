/**
 * ServerPicker behavior tests.
 *
 * Pins down the "silent missing-tab → always-render-with-disabled"
 * fix: the picker must ALWAYS render all 3 type tabs (sub, hsub, dub),
 * regardless of how many providers the upstream returned. Empty tabs
 * are disabled with an explanatory tooltip; clicking an empty tab
 * must be a no-op (no streamType swap, no activeProvider swap).
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
    // The fix: ALL three tabs render, with empty ones disabled.
    expect(tabButton('Sub')).toBeInTheDocument()
    expect(tabButton('H-Subs')).toBeInTheDocument()
    expect(tabButton('Dub')).toBeInTheDocument()
  })

  it('empty tabs are rendered as disabled with the explanatory tooltip', () => {
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
    expect(dubBtn).toBeDisabled()
    // Tooltip mentions the most likely cause (anidap upstream blocked)
    // and the alternative explanation (no dub exists for the title).
    expect(dubBtn.title).toMatch(/Dub servers aren't available/i)
    expect(dubBtn.title).toMatch(/chad\.anidap\.se/i)

    const hsubBtn = tabButton('H-Subs')
    expect(hsubBtn).toBeDisabled()
    expect(hsubBtn.title).toMatch(/H-Subs servers aren't available/i)
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

  it('clicking an empty tab is a NO-OP — no streamType/provider change', async () => {
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
    // userEvent respects the `disabled` HTML attr and will not dispatch
    // click on a disabled button — so even attempting to click is a no-op.
    await user.click(dubBtn)
    expect(onChangeType).not.toHaveBeenCalled()
    expect(onChangeProvider).not.toHaveBeenCalled()
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
