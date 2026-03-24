import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy – Vorra',
};

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-12 text-slate-700">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-6">
        Privacy Policy
      </h1>
      <p className="text-sm text-slate-500 mb-8">
        Last updated: March 19, 2026
      </p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            What We Collect
          </h2>
          <p>
            Vorra accesses your Gmail inbox via the Google Gmail API
            using the <code>gmail.modify</code> scope. This allows Vorra
            to read email metadata and perform organizational actions on your
            behalf. We collect and store:
          </p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Your email address (for account identification)</li>
            <li>Email metadata (sender, subject, date, snippet)</li>
            <li>AI-generated category labels for your emails</li>
            <li>
              Encrypted OAuth tokens (to maintain your Gmail connection)
            </li>
          </ul>
          <p className="mt-2">
            Email body content is fetched on demand for display and AI-assisted
            reply drafting, but is <strong>not</strong> stored permanently or
            used for AI training. Only metadata and short snippets are used for
            categorization.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            How We Use Your Data
          </h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              To sync and display your email metadata in an organized view
            </li>
            <li>
              To categorize emails using AI (Anthropic Claude API) based on
              metadata and snippets
            </li>
            <li>
              To perform email actions you initiate: marking as read/unread,
              archiving, trashing, starring, snoozing, and sending replies
            </li>
            <li>To maintain your session and preferences</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Third-Party Services
          </h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              <strong>Google Gmail API</strong> — read and modify access to
              sync email metadata and perform user-initiated actions (archive,
              trash, star, mark read/unread, send replies)
            </li>
            <li>
              <strong>Supabase</strong> — authentication and database hosting
            </li>
            <li>
              <strong>Anthropic Claude API</strong> — AI categorization of
              email metadata
            </li>
            <li>
              <strong>Vercel</strong> — application hosting
            </li>
          </ul>
          <p className="mt-2">
            Email metadata sent to the Claude API for categorization is not
            stored by Anthropic and is subject to their{' '}
            <a
              href="https://www.anthropic.com/privacy"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              privacy policy
            </a>
            .
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">Data Storage</h2>
          <p>
            Your data is stored in a Supabase-hosted PostgreSQL database with
            row-level security. OAuth tokens are encrypted at rest using
            AES-256-GCM. All data transmission uses HTTPS.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Data Deletion
          </h2>
          <p>
            You can revoke Vorra&apos;s access at any time from your{' '}
            <a
              href="https://myaccount.google.com/permissions"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Account permissions
            </a>
            . To request deletion of all stored data, contact us at the email
            below.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">Contact</h2>
          <p>
            For privacy questions, contact:{' '}
            <a
              href="mailto:syzygycrisis@gmail.com"
              className="text-blue-600 hover:underline"
            >
              syzygycrisis@gmail.com
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
