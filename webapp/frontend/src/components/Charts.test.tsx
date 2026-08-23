import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarChart, PieChart } from './Charts';

describe('PieChart', () => {
  it('renders "No data yet." when every count is zero, instead of an empty/broken SVG', () => {
    render(<PieChart rows={[{ label: 'Open', count: 0 }, { label: 'Closed', count: 0 }]} />);
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });

  it('renders one legend row with a count and percentage per nonzero slice, skipping zero-count rows', () => {
    render(<PieChart rows={[{ label: 'Answered', count: 3 }, { label: 'Missed', count: 1 }, { label: 'Pending', count: 0 }]} />);
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.getByText('3 (75%)')).toBeInTheDocument();
    expect(screen.getByText('Missed')).toBeInTheDocument();
    expect(screen.getByText('1 (25%)')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });
});

describe('BarChart', () => {
  it('renders "No data yet." for an empty row set', () => {
    render(<BarChart rows={[]} />);
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });

  it('renders one column per row with its count', () => {
    render(<BarChart rows={[{ label: 'Raipur', count: 5 }, { label: 'Coimbatore', count: 2 }]} />);
    expect(screen.getByText('Raipur')).toBeInTheDocument();
    expect(screen.getByText('Coimbatore')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
