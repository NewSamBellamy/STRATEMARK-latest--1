import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResearchMarkdown } from './ResearchMarkdown';

describe('ResearchMarkdown storage-artifact repair', () => {
  it('unescapes escaped newlines and asterisks in mixed content', () => {
    const raw = 'OpenAI operates three functions: ' + String.fromCharCode(92) + 'n* ' + String.fromCharCode(92) + '**Research Team:**' + String.fromCharCode(92) + 'n Advances foundational AI.';
    render(<ResearchMarkdown text={raw} />);
    expect(screen.getByText('Research Team:')).toBeInTheDocument();
    expect(screen.queryByText(/{''\*'}'/)).not.toBeInTheDocument();
  });
  it('keeps real markdown bold rendering as bold', () => {
    render(<ResearchMarkdown text={'Real **bold** text.'} />);
    expect(screen.getByText('bold')).toBeInTheDocument();
  });
});
