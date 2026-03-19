import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service – InboxPilot',
};

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-12 text-slate-700">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-6">
        Terms of Service
      </h1>
      <p className="text-sm text-slate-500 mb-8">
        Last updated: March 19, 2026
      </p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Acceptance of Terms
          </h2>
          <p>
            By using InboxPilot, you agree to these terms. If you do not agree,
            do not use the service.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Description of Service
          </h2>
          <p>
            InboxPilot is a web application that connects to your Gmail account
            and uses AI to automatically categorize, organize, and help you
            manage your email inbox. InboxPilot can read email metadata, perform
            organizational actions (archive, trash, star, mark read/unread,
            snooze), and send replies on your behalf when you explicitly
            initiate these actions.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">Your Account</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              You authenticate via Google OAuth. We do not store your Google
              password.
            </li>
            <li>
              You are responsible for maintaining the security of your Google
              account.
            </li>
            <li>
              You may revoke access at any time via your Google Account
              settings.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Permitted Use
          </h2>
          <p>You agree to use InboxPilot only for lawful purposes. You may not:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Use the service to violate any applicable laws</li>
            <li>Reverse-engineer or exploit the service</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            AI Categorization
          </h2>
          <p>
            Email categorization is performed by AI and may not always be
            accurate. InboxPilot performs email actions (archive, trash, star,
            snooze, send replies) only when you explicitly initiate them.
            AI-drafted replies are always shown for your review and editing
            before sending — InboxPilot never sends emails automatically
            without your confirmation.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Disclaimer of Warranties
          </h2>
          <p>
            InboxPilot is provided &quot;as is&quot; without warranties of any
            kind. We do not guarantee uninterrupted or error-free operation.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by law, InboxPilot shall not be
            liable for any indirect, incidental, or consequential damages
            arising from your use of the service.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">
            Changes to Terms
          </h2>
          <p>
            We may update these terms at any time. Continued use of the service
            after changes constitutes acceptance of the new terms.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 mb-2">Contact</h2>
          <p>
            Questions? Contact:{' '}
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
