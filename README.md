# MayaX Lead Hub

MayaX Lead Hub is a modern B2B lead generation, grading, and marketplace platform. It allows businesses and agents to ingest, score, discover, and purchase verified leads with integrated wallet billing and automated webhook pipelines.

---

## ✨ Features

- **Lead Marketplace**: Real-time lead discovery with automated scoring and quality grading.
- **Wallet & Billing**: Pre-funded digital wallet, Stripe checkout integration, and automated refills (AutoPay).
- **Inbound Lead Ingestion**: Multi-step public lead capture forms (`/apply`) and secure webhook endpoints for Make.com / third-party CRM ingestion.
- **Admin Control Center**: Webhook tester, template generator, rejected lead inspector, and transactional email queue monitoring.
- **Agent Toolkit**: Built-in dynamic calling scripts and lead conversion helpers.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Shadcn UI / Radix UI, TanStack Query
- **Backend & Auth**: Supabase (PostgreSQL, Row Level Security, Edge Functions)
- **Payments**: Stripe (Wallet deposits, subscriptions, AutoPay)
- **Email & Routing**: Transactional SMTP queue & automated suppression handling

---

## 🚀 Getting Started

### Prerequisites

- Node.js (>= 20) or Bun

### 1. Install Dependencies

```bash
# Using npm
npm install

# Or using Bun
bun install
```

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
VITE_SUPABASE_PROJECT_ID=your_project_id
```

### 3. Run Development Server

```bash
npm run dev
# Or
bun run dev
```

Visit `http://localhost:5173` in your browser.

---

## 📜 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts Vite local development server |
| `npm run build` | Builds production bundle |
| `npm run preview` | Previews production build locally |
| `npm run test` | Runs unit & component tests via Vitest |
| `npm run lint` | Lints project files with ESLint |

# pgx_lead
