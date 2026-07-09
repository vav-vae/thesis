"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import {
  auth,
  db,
} from "@/lib/firebase";
import { uploadDocumentToCloudinary, uploadImageToCloudinary } from "@/lib/cloudinary";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Check,
  Phone,
  MapPin,
  Sparkles,
  Briefcase,
  Upload,
  ShieldCheck,
  BadgeCheck,
  FileText,
  ClipboardCheck,
  ChevronLeft,
} from "lucide-react";

const RequiredMark = () => (
  <span aria-hidden="true" className="ml-1 text-red-600">
    *
  </span>
);

export default function RegisterPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" /></div>}><RegisterForm /></Suspense>;
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountRole = searchParams.get("role") === "broker" ? "broker" : "buyer";
  const mobilePrefix = "+639";
  const [currentStep, setCurrentStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState(mobilePrefix);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [preferredPropertyType, setPreferredPropertyType] = useState("House");
  const [budgetRange, setBudgetRange] = useState("");
  const [preferredProvince, setPreferredProvince] = useState("");
  const [preferredCity, setPreferredCity] = useState("");
  const [occupation, setOccupation] = useState("");
  const [shortBio, setShortBio] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agencyName, setAgencyName] = useState("");
  const [position, setPosition] = useState("");
  const [prcLicense, setPrcLicense] = useState("");
  const [experience, setExperience] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [governmentId, setGovernmentId] = useState<File | null>(null);
  const [prcLicenseFile, setPrcLicenseFile] = useState<File | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const isBroker = accountRole === "broker";
  const isBuyer = accountRole === "buyer";
  const steps = isBroker
    ? ["Account", "Personal Details", "Professional Details", "Verification"]
    : ["Account Information", "Buyer Preferences", "Optional Profile", "Terms"];

  const normalizePhoneNumber = (value: string) => {
    const digits = value.replace(/[^\d+]/g, "");

    if (!digits || digits === "+") {
      return mobilePrefix;
    }

    if (digits.startsWith(mobilePrefix)) {
      return digits.slice(0, mobilePrefix.length) + digits.slice(mobilePrefix.length).replace(/\D/g, "");
    }

    if (digits.startsWith("+63")) {
      return `${mobilePrefix}${digits.slice(3).replace(/\D/g, "")}`;
    }

    if (digits.startsWith("639")) {
      return `+${digits}`;
    }

    if (digits.startsWith("09")) {
      return `${mobilePrefix}${digits.slice(2).replace(/\D/g, "")}`;
    }

    if (digits.startsWith("9")) {
      return `${mobilePrefix}${digits.slice(1).replace(/\D/g, "")}`;
    }

    const localDigits = digits.replace(/^\+/, "").replace(/^63/, "").replace(/^0/, "");
    return `${mobilePrefix}${localDigits.replace(/\D/g, "")}`;
  };

  const handlePhoneChange = (value: string) => {
    setPhone(normalizePhoneNumber(value));
  };

  const goNext = () => {
    setError("");

    if (isBroker && currentStep === 1) {
      if (!email || !password || !confirmPassword) {
        setError("Please complete the account details");
        return;
      }

      if (password.length < 6) {
        setError("Password must be at least 6 characters");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    if (isBroker && currentStep === 2) {
      if (!name || !phone || !profilePhoto) {
        setError("Please complete your personal details");
        return;
      }
    }

    if (isBroker && currentStep === 3) {
      if (!agencyName || !position || !experience || !serviceArea) {
        setError("Please complete your professional details");
        return;
      }
    }

    if (isBroker && currentStep === 4) {
      if (!governmentId) {
        setError("Please upload your government ID");
        return;
      }

      if (!acceptedTerms) {
        setError("Please accept the terms and conditions");
        return;
      }
    }

    if (isBuyer && currentStep === 1) {
      if (!firstName || !lastName || !email || !phone || !password || !confirmPassword) {
        setError("Please complete the account information");
        return;
      }

      if (password.length < 6) {
        setError("Password must be at least 6 characters");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    if (isBuyer && currentStep === 2) {
      if (!preferredPropertyType || !budgetRange || !preferredProvince || !preferredCity) {
        setError("Please complete your buyer preferences");
        return;
      }
    }

    if (isBuyer && currentStep === 4) {
      if (!agreeTerms || !agreePrivacy) {
        setError("Please agree to the Terms and Privacy Policy");
        return;
      }
    }

    setCurrentStep((step) => Math.min(step + 1, 4));
  };

  const goBack = () => {
    setError("");
    setCurrentStep((step) => Math.max(step - 1, 1));
  };

  const register = async () => {
    setError("");

    const fullName = `${firstName} ${lastName}`.trim();
    const missingBuyerFields =
      !firstName ||
      !lastName ||
      !email ||
      !password ||
      !phone ||
      !preferredPropertyType ||
      !budgetRange ||
      !preferredProvince ||
      !preferredCity ||
      !agreeTerms ||
      !agreePrivacy;
    const missingBrokerFields =
      !name ||
      !email ||
      !password ||
      !phone ||
      !agencyName ||
      !position ||
      !experience ||
      !serviceArea ||
      !profilePhoto ||
      !governmentId ||
      !acceptedTerms;

    if (accountRole === "buyer" ? missingBuyerFields : missingBrokerFields) {
      setError("Please fill all fields");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (isBroker && !acceptedTerms) {
      setError("Please accept the terms and conditions");
      return;
    }

    if (isBuyer && (!agreeTerms || !agreePrivacy)) {
      setError("Please agree to the Terms and Privacy Policy");
      return;
    }

    try {
      setLoading(true);

      const [profilePhotoUrl, governmentIdUrl, prcLicenseFileUrl] = await Promise.all([
        profilePhoto ? uploadImageToCloudinary(profilePhoto) : Promise.resolve(null),
        governmentId ? uploadDocumentToCloudinary(governmentId) : Promise.resolve(null),
        prcLicenseFile ? uploadDocumentToCloudinary(prcLicenseFile) : Promise.resolve(null),
      ]);

      let user = auth.currentUser;
      const canResumeFailedRegistration =
        user?.email?.toLowerCase() === email.trim().toLowerCase()
        && !(await getDoc(doc(db, "users", user.uid))).exists();

      if (!canResumeFailedRegistration) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
      }

      if (!user) {
        throw new Error("Unable to create the account. Please try again.");
      }

      await setDoc(
        doc(db, "users", user.uid),
        {
          uid: user.uid,
          name: isBuyer ? fullName : name,
          email,
          phone,
          ...(isBuyer
            ? {
                firstName,
                lastName,
                preferredPropertyType,
                budgetRange,
                preferredProvince,
                preferredCity,
                profilePicture: profilePhotoUrl,
                occupation: occupation || null,
                shortBio: shortBio || null,
                termsAccepted: agreeTerms,
                privacyPolicyAccepted: agreePrivacy,
              }
            : {}),
          ...(accountRole === "broker"
            ? {
                profilePhoto: profilePhotoUrl,
                agencyName,
                position,
                prcLicense: prcLicense || null,
                experience,
                serviceArea,
                governmentId: governmentIdUrl,
                prcLicenseFile: prcLicenseFileUrl,
                verificationStatus: "pending",
                rejectionReason: null,
              }
            : {}),
          role: accountRole,
          createdAt: new Date(),
        }
      );

      setSuccess(true);
      setTimeout(() => {
        router.push("/login");
      }, 1500);

    } catch (error: unknown) {
      const err = error instanceof Error ? error.message : String(error);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className={`w-full ${isBroker ? "max-w-4xl xl:max-w-5xl" : "max-w-md"}`}>
        
        {/* Header Logo */}
        <div className="text-center mb-12 animate-fade-in">
          <div className="mb-6 inline-flex items-center justify-center gap-4">
            <div className="relative h-16 w-16 flex-shrink-0">
              <Image src="/logo.png" alt="LiBot Logo" fill sizes="64px" className="object-contain" priority />
            </div>

            <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600">
                {isBroker ? "Broker Registration" : "Buyer Registration"}
            </div>
          </div>

          <h1 className="text-3xl font-light tracking-tight text-slate-900 mb-2">
              {isBroker ? "Create your broker account" : "Create your buyer account"}
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
              {isBroker
              ? "Set up your broker profile to manage listings and inquiries"
                : "Set up your buyer profile in four quick steps"}
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-10 animate-fade-in-delay">
          
          {/* Error State */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 animate-slide-down">
              <div className="w-5 h-5 rounded-full bg-red-200 flex-shrink-0 flex items-center justify-center mt-0.5">
                <span className="text-xs text-red-600 font-semibold">!</span>
              </div>
              <p className="text-sm text-red-600 leading-relaxed">{error}</p>
            </div>
          )}

          {/* Success State */}
          {success && (
            <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-3 animate-slide-down">
              <div className="w-5 h-5 rounded-full bg-emerald-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check size={16} className="text-emerald-600" />
              </div>
              <p className="text-sm text-emerald-600 leading-relaxed">Account created successfully! Redirecting...</p>
            </div>
          )}

          {/* Form */}
          {accountRole === "broker" && (
            <div className="mb-8">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {steps.map((step, index) => {
                  const stepNumber = index + 1;
                  const active = currentStep === stepNumber;
                  const completed = currentStep > stepNumber;

                  return (
                    <div key={step} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${active || completed ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-400"}`}>
                        {completed ? <Check size={14} /> : stepNumber}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-xs font-semibold uppercase tracking-wider ${active ? "text-slate-900" : "text-slate-400"}`}>
                          Step {stepNumber}
                        </p>
                        <p className="text-sm text-slate-600">{step}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-5">
            
            {isBuyer && currentStep === 1 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldCheck size={16} className="text-slate-500" />
                    Step 1 of 4: Account Information
                  </div>
                  <p className="mt-2 text-sm text-slate-600">The essentials to create your account.</p>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="group">
                    <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                      First Name <RequiredMark />
                    </label>
                    <div className="relative">
                      <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                      <input type="text" placeholder="John" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    </div>
                  </div>

                  <div className="group">
                    <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Last Name <RequiredMark />
                    </label>
                    <div className="relative">
                      <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                      <input type="text" placeholder="Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    </div>
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Email Address <RequiredMark /></label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Mobile Number <RequiredMark /></label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="tel" placeholder="+639 17 555 0192" value={phone} onChange={(e) => handlePhoneChange(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Password <RequiredMark /></label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type={showPassword ? "text" : "password"} placeholder="Create a strong password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} disabled={loading || success} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:cursor-not-allowed">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Confirm Password <RequiredMark /></label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type={showConfirmPassword ? "text" : "password"} placeholder="Re-enter your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} disabled={loading || success} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:cursor-not-allowed">
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isBuyer && currentStep === 2 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <MapPin size={16} className="text-slate-500" />
                    Step 2 of 4: Buyer Preferences
                  </div>
                  <p className="mt-2 text-sm text-slate-600">These fields make recommendations and search more personalized.</p>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Preferred Property Type <RequiredMark /></label>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {["House", "Condominium", "Apartment", "Lot", "Commercial Property"].map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setPreferredPropertyType(option)}
                        className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${preferredPropertyType === option ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Budget Range <RequiredMark /></label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {["Below ₱1M", "₱1M – ₱3M", "₱3M – ₱5M", "Above ₱5M"].map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setBudgetRange(option)}
                        className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${budgetRange === option ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="group">
                    <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Province <RequiredMark /></label>
                    <div className="relative">
                      <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                      <input type="text" placeholder="Province" value={preferredProvince} onChange={(e) => setPreferredProvince(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    </div>
                  </div>

                  <div className="group">
                    <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">City / Municipality <RequiredMark /></label>
                    <div className="relative">
                      <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                      <input type="text" placeholder="City / Municipality" value={preferredCity} onChange={(e) => setPreferredCity(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isBuyer && currentStep === 3 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Sparkles size={16} className="text-slate-500" />
                    Step 3 of 4: Optional Profile
                  </div>
                  <p className="mt-2 text-sm text-slate-600">These can be completed later but are useful.</p>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Profile Picture</label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50">
                    <Upload size={18} className="text-slate-500" />
                    <span>{profilePhoto ? profilePhoto.name : "Upload profile picture"}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setProfilePhoto(e.target.files?.[0] ?? null)} />
                  </label>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Occupation</label>
                  <div className="relative">
                    <Briefcase size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="text" placeholder="Occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Short Bio (optional)</label>
                  <textarea placeholder='Looking for a family home near the city.' value={shortBio} onChange={(e) => setShortBio(e.target.value)} disabled={loading || success} className="w-full min-h-28 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                </div>
              </div>
            )}

            {isBuyer && currentStep === 4 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ClipboardCheck size={16} className="text-slate-500" />
                    Step 4 of 4: Terms
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Please review and accept the policies to continue.</p>
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900" />
                  <span>I agree to the Terms and Conditions</span>
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900" />
                  <span>I agree to the Privacy Policy</span>
                </label>
              </div>
            )}

            {isBuyer && (
              <div className="flex items-center justify-between gap-4 pt-2">
                {currentStep > 1 ? (
                  <button
                    type="button"
                    onClick={goBack}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  >
                    <ChevronLeft size={16} />
                    Back
                  </button>
                ) : (
                  <div />
                )}

                {currentStep < 4 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Next
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    onClick={register}
                    disabled={loading || success}
                    className="w-full sm:w-auto sm:min-w-48 h-12 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-2 group disabled:cursor-not-allowed shadow-sm hover:shadow-md active:scale-95"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : success ? (
                      <>
                        <Check size={18} className="animate-pulse" />
                        Account Created
                      </>
                    ) : (
                      <>
                        Submit
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {isBroker && currentStep === 1 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldCheck size={16} className="text-slate-500" />
                    Step 1 of 4: Account
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Email, password, and confirmation are required to secure the account.</p>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Email Address <RequiredMark />
                  </label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Password <RequiredMark />
                  </label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type={showPassword ? "text" : "password"} placeholder="Create a strong password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} disabled={loading || success} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:cursor-not-allowed">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Confirm Password <RequiredMark />
                  </label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type={showConfirmPassword ? "text" : "password"} placeholder="Re-enter your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} disabled={loading || success} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:cursor-not-allowed">
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isBroker && currentStep === 2 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <User size={16} className="text-slate-500" />
                    Step 2 of 4: Personal Details
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Add the basics so your broker profile is easy to recognize.</p>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Name <RequiredMark />
                  </label>
                  <div className="relative">
                    <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="text" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Phone Number <RequiredMark />
                  </label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="tel" placeholder="+639 17 555 0192" value={phone} onChange={(e) => handlePhoneChange(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Profile Photo <RequiredMark />
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50">
                    <Upload size={18} className="text-slate-500" />
                    <span>{profilePhoto ? profilePhoto.name : "Upload profile photo"}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setProfilePhoto(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
              </div>
            )}

            {isBroker && currentStep === 3 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Briefcase size={16} className="text-slate-500" />
                    Step 3 of 4: Professional Details
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Tell buyers who you work with and where you operate.</p>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Agency Name <RequiredMark />
                  </label>
                  <div className="relative">
                    <Briefcase size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="text" placeholder="Agency / Company name" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Position <RequiredMark />
                  </label>
                  <div className="relative">
                    <BadgeCheck size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="text" placeholder="Broker, Sales Agent, etc." value={position} onChange={(e) => setPosition(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    PRC License (optional)
                  </label>
                  <div className="relative">
                    <FileText size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="text" placeholder="License number or code" value={prcLicense} onChange={(e) => setPrcLicense(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Experience <RequiredMark />
                  </label>
                  <textarea placeholder="Years of experience, specialty, and background" value={experience} onChange={(e) => setExperience(e.target.value)} disabled={loading || success} className="w-full min-h-28 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Service Area <RequiredMark />
                  </label>
                  <div className="relative">
                    <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                    <input type="text" placeholder="Metro Manila and nearby cities" value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} disabled={loading || success} className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>
              </div>
            )}

            {isBroker && currentStep === 4 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ClipboardCheck size={16} className="text-slate-500" />
                    Step 4 of 4: Verification
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Upload your verification documents and accept the terms to finish.</p>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Government ID <RequiredMark />
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50">
                    <Upload size={18} className="text-slate-500" />
                    <span>{governmentId ? governmentId.name : "Upload government ID"}</span>
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setGovernmentId(e.target.files?.[0] ?? null)} />
                  </label>
                </div>

                <div className="group">
                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                    PRC License upload (if available)
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50">
                    <Upload size={18} className="text-slate-500" />
                    <span>{prcLicenseFile ? prcLicenseFile.name : "Upload PRC license file"}</span>
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setPrcLicenseFile(e.target.files?.[0] ?? null)} />
                  </label>
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900" />
                  <span>I agree to the Terms & Conditions and confirm the information provided is accurate.</span>
                </label>
              </div>
            )}

            {isBroker && (
              <>
                {currentStep === 4 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <ClipboardCheck size={16} className="text-slate-500" />
                      Final review
                    </div>
                    <p className="mt-2">Please confirm your details and accept the terms before submitting your broker application.</p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 pt-2">
                  {currentStep > 1 ? (
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    >
                      <ChevronLeft size={16} />
                      Back
                    </button>
                  ) : (
                    <div />
                  )}

                  {currentStep < 4 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Next
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={register}
                      disabled={loading || success}
                      className="w-full sm:w-auto sm:min-w-48 h-12 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-2 group disabled:cursor-not-allowed shadow-sm hover:shadow-md active:scale-95"
                    >
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : success ? (
                        <>
                          <Check size={18} className="animate-pulse" />
                          Account Created
                        </>
                      ) : (
                        <>
                          Submit
                          <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </>
            )}

          </div>

          {/* Footer Link */}
          <div className="mt-8 text-center">
            <p className="text-sm text-slate-600">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-semibold text-slate-900 hover:text-slate-700 hover:underline transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>

        </div>

        {/* Trust Indicators */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">Trusted by real estate professionals</p>
        </div>

      </div>
    </div>
  );
}
