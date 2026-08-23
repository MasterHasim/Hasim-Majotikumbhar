import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { WhatsAppNumber, WhoAmI } from '../types';

const NUMBER: WhatsAppNumber = { id: 'num-1', displayName: 'Test Number', phoneNumber: '+91 79 4850 2801', active: true };

function whoAmI(roleKeys: string[]): WhoAmI {
  return { id: 'user-1', email: 'agent@example.com', displayName: 'Test Agent', roleKeys };
}

function renderSidebar(roleKeys: string[]) {
  return render(
    <Sidebar
      number={NUMBER}
      whoAmI={whoAmI(roleKeys)}
      page="inbox"
      needsResponseCount={0}
      leadsToCallCount={0}
      onNavigate={() => {}}
      onSwitchNumber={() => {}}
      onSignOut={() => {}}
    />,
  );
}

// Regression coverage for the real bug fixed 2026-08-24 (see App.tsx): the app used to default
// every signed-in user to a REPORTS_VIEW-gated page with zero role-awareness, so an AGENT would
// land on a page they can't see. These assertions pin down exactly which roles see which nav
// items, so that class of bug can't silently come back.
describe('Sidebar nav item visibility by role', () => {
  it('hides Home, Dashboard, and Admin from a plain AGENT (no REPORTS_VIEW / admin permissions)', () => {
    renderSidebar(['AGENT']);
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    // Every role can always reach Inbox — the fallback an AGENT is redirected to.
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
  });

  it('shows Home and Dashboard, but not Admin, for a VIEWER (REPORTS_VIEW only)', () => {
    renderSidebar(['VIEWER']);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows every gated nav item for ADMIN', () => {
    renderSidebar(['ADMIN']);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('shows a leads-to-call badge only when the count is positive', () => {
    const { rerender } = render(
      <Sidebar number={NUMBER} whoAmI={whoAmI(['AGENT'])} page="leads" needsResponseCount={0} leadsToCallCount={0}
        onNavigate={() => {}} onSwitchNumber={() => {}} onSignOut={() => {}} />,
    );
    expect(screen.queryByTitle('Assigned to you, not yet called')).not.toBeInTheDocument();

    rerender(
      <Sidebar number={NUMBER} whoAmI={whoAmI(['AGENT'])} page="leads" needsResponseCount={0} leadsToCallCount={3}
        onNavigate={() => {}} onSwitchNumber={() => {}} onSignOut={() => {}} />,
    );
    expect(screen.getByTitle('Assigned to you, not yet called')).toHaveTextContent('3');
  });
});
