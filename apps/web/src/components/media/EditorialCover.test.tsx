import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorialCover } from './EditorialCover';

describe('EditorialCover placeholder', () => {
  it('shows the publisher and the headline over the card art, with no generated image', () => {
    const { container } = render(<EditorialCover title="Acme raises a round" url="https://www.reuters.com/a" />);
    expect(screen.getByText('Acme raises a round')).toBeInTheDocument();
    expect(screen.getByText(/reuters/i)).toBeInTheDocument();
    expect(container.querySelector('img[draggable="false"]')).not.toBeNull();
  });

  it('picks the same art for the same publisher every time', () => {
    const art = (title: string) => render(<EditorialCover title={title} url="https://www.reuters.com/x" />).container.querySelector('img[draggable="false"]')?.getAttribute('src');
    expect(art('One')).toBe(art('Two'));
  });
});
