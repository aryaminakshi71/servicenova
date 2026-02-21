import {
    Wrench,
    Truck,
    Zap,
    Clock,
    CheckCircle2,
    ArrowRight,
    Menu,
    X,
    Users,
    MapPin,
    Calendar,
} from "lucide-react";
import { useState } from "react";

export function LandingPage({ onLogin }: { onLogin: () => void }) {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const features = [
        {
            icon: Truck,
            title: "Smart Dispatch",
            description: "AI-optimized routing and technician assignment to minimize travel time.",
        },
        {
            icon: Clock,
            title: "Real-time Scheduling",
            description: "Dynamic schedule adjustments based on traffic, job duration, and availability.",
        },
        {
            icon: Wrench,
            title: "Technician Assist",
            description: "Equip your field team with AI diagnostics and repair guides.",
        },
        {
            icon: Users,
            title: "Customer Portal",
            description: "Real-time tracking and self-service booking for your customers.",
        },
    ];

    const pricingPlans = [
        {
            name: "Micro",
            price: 29,
            features: ["3 Technicians", "Basic Scheduling", "Email Support", "Mobile App"],
            popular: false,
        },
        {
            name: "Growth",
            price: 99,
            features: [
                "15 Technicians",
                "Route Optimization",
                "Priority Support",
                "Inventory Mgmt",
            ],
            popular: true,
        },
        {
            name: "Pro",
            price: 299,
            features: [
                "Unlimited Techs",
                "AI Dispatching",
                "API Access",
                "White Labeling",
            ],
            popular: false,
        },
    ];

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <nav className="fixed top-0 z-50 w-full border-b border-orange-100 bg-white/90 backdrop-blur-md">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600">
                            <Zap className="h-5 w-5 text-white" />
                        </div>
                        <span className="text-xl font-bold text-slate-900">ServiceNova AI</span>
                    </div>
                    <div className="hidden items-center gap-8 md:flex">
                        <a href="#features" className="text-sm font-medium text-slate-600 hover:text-orange-600">
                            Features
                        </a>
                        <a href="#pricing" className="text-sm font-medium text-slate-600 hover:text-orange-600">
                            Pricing
                        </a>
                        <button
                            onClick={onLogin}
                            className="rounded-full bg-orange-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
                        >
                            Sign In
                        </button>
                    </div>
                    <button
                        className="md:hidden"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    >
                        {mobileMenuOpen ? (
                            <X className="h-6 w-6 text-slate-600" />
                        ) : (
                            <Menu className="h-6 w-6 text-slate-600" />
                        )}
                    </button>
                </div>
                {mobileMenuOpen && (
                    <div className="border-t border-orange-100 bg-white md:hidden">
                        <div className="space-y-1 px-4 py-4">
                            <a
                                href="#features"
                                className="block px-3 py-2 text-base font-medium text-slate-600 hover:bg-slate-50 hover:text-orange-600"
                            >
                                Features
                            </a>
                            <a
                                href="#pricing"
                                className="block px-3 py-2 text-base font-medium text-slate-600 hover:bg-slate-50 hover:text-orange-600"
                            >
                                Pricing
                            </a>
                            <button
                                onClick={onLogin}
                                className="block w-full rounded-md bg-orange-600 px-3 py-2 text-center text-base font-medium text-white hover:bg-orange-700"
                            >
                                Sign In
                            </button>
                        </div>
                    </div>
                )}
            </nav>

            <main>
                <section className="pt-32 pb-16 md:pt-48 md:pb-32 bg-gradient-to-br from-orange-50 via-white to-orange-50">
                    <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
                        <div className="mb-8 inline-flex items-center rounded-full border border-orange-200 bg-white px-4 py-1.5 text-sm font-medium text-orange-700 shadow-sm">
                            <Clock className="mr-2 h-4 w-4 text-orange-500" />
                            <span>Reduce response times by 40%</span>
                        </div>
                        <h1 className="mb-6 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
                            Field Service Management <br className="hidden md:block" />
                            <span className="text-orange-600">Reimagined</span>
                        </h1>
                        <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-600 md:text-xl">
                            Intelligent dispatch, automated scheduling, and powerful mobile tools
                            to empower your workforce and delight your customers.
                        </p>
                        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                            <button
                                onClick={onLogin}
                                className="inline-flex items-center justify-center gap-2 rounded-full bg-orange-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-orange-200 transition-all hover:bg-orange-700 hover:shadow-xl hover:-translate-y-0.5"
                            >
                                Start Free Trial
                                <ArrowRight className="h-4 w-4" />
                            </button>
                            <button
                                onClick={onLogin}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-8 py-3.5 text-base font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow-md"
                            >
                                Watch Video
                            </button>
                        </div>
                    </div>
                </section>

                <section id="features" className="py-24">
                    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                        <div className="mb-16 text-center">
                            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                                Built for the Field
                            </h2>
                            <p className="mt-4 text-lg text-slate-600">
                                Tools that work as hard as your team does.
                            </p>
                        </div>
                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
                            {features.map((feature, index) => (
                                <div
                                    key={index}
                                    className="group rounded-2xl border border-slate-100 bg-white p-8 shadow-sm transition-all hover:border-orange-100 hover:shadow-md"
                                >
                                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-colors">
                                        <feature.icon className="h-6 w-6" />
                                    </div>
                                    <h3 className="mb-3 text-lg font-semibold text-slate-900">
                                        {feature.title}
                                    </h3>
                                    <p className="text-slate-600">{feature.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="pricing" className="bg-slate-50 py-24">
                    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                        <div className="mb-16 text-center">
                            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                                Scale Your Operations
                            </h2>
                            <p className="mt-4 text-lg text-slate-600">
                                Pricing that grows with your business.
                            </p>
                        </div>
                        <div className="grid gap-8 md:grid-cols-3 lg:max-w-5xl lg:mx-auto">
                            {pricingPlans.map((plan, index) => (
                                <div
                                    key={index}
                                    className={`rounded-2xl border p-8 ${plan.popular
                                            ? "border-orange-600 bg-white shadow-xl ring-1 ring-orange-600 relative overflow-hidden"
                                            : "border-slate-200 bg-white shadow-sm"
                                        }`}
                                >
                                    {plan.popular && (
                                        <div className="absolute top-0 right-0 -mt-2 -mr-2 h-16 w-16 overflow-hidden rounded-bl-3xl bg-orange-600 pt-4 pl-1 text-center text-xs font-bold text-white">
                                            POPULAR
                                        </div>
                                    )}
                                    <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                                    <div className="my-4 flex items-baseline text-slate-900">
                                        <span className="text-4xl font-extrabold tracking-tight">
                                            ${plan.price}
                                        </span>
                                        <span className="ml-1 text-lg font-medium text-slate-500">
                                            /mo
                                        </span>
                                    </div>
                                    <ul className="mb-8 space-y-4">
                                        {plan.features.map((feature, i) => (
                                            <li key={i} className="flex items-center text-slate-600">
                                                <CheckCircle2 className="mr-3 h-5 w-5 text-orange-500" />
                                                {feature}
                                            </li>
                                        ))}
                                    </ul>
                                    <button
                                        onClick={onLogin}
                                        className={`w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${plan.popular
                                                ? "bg-orange-600 text-white hover:bg-orange-700"
                                                : "bg-slate-100 text-slate-900 hover:bg-slate-200"
                                            }`}
                                    >
                                        Start Now
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="bg-orange-900 py-24 text-white">
                    <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
                        <h2 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
                            Ready to Optimize your Workforce?
                        </h2>
                        <p className="mb-10 text-xl text-orange-100">
                            Join thousands of service providers delivering excellence with ServiceNova.
                        </p>
                        <button
                            onClick={onLogin}
                            className="rounded-full bg-white px-8 py-3.5 text-base font-bold text-orange-900 shadow-lg transition-transform hover:scale-105"
                        >
                            Get Started for Free
                        </button>
                    </div>
                </section>
            </main>

            <footer className="border-t border-slate-200 bg-white py-12">
                <div className="mx-auto max-w-7xl px-4 text-center text-slate-500 sm:px-6 lg:px-8">
                    <p>&copy; 2026 ServiceNova AI. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
}
