import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '../components/Navbar';
import { AuthProvider } from '../context/AuthContext';

export const metadata: Metadata = {
  title: 'AI Document Workspace',
  description: 'Intelligent document processing and analysis workspace powered by AI.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased flex flex-col">
        <AuthProvider>
          <Navbar />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
          <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500">
            AI Document Workspace &bull; Authentication &amp; RBAC Active
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
