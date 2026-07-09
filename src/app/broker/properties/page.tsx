"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  collection,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

import {
  onAuthStateChanged,
} from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import NotificationCenter from "@/components/NotificationCenter";
import {
  Home,
  MapPin,
  PhilippinePeso,
  Edit,
  Trash2,
  Plus,
  Menu,
  X,
  LayoutDashboard,
  UploadCloud,
  Images,
  UserRound,
  MessageSquare,
  Settings,
} from "lucide-react";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  image?: string;
  availabilityStatus?: "available" | "reserved" | "sold";
  createdAt?: Timestamp | Date;
  [key: string]: unknown;
}

export default function BrokerPropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [updatingAvailability, setUpdatingAvailability] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      const q = query(
        collection(db, "properties"),
        where("brokerId", "==", user.uid)
      );

      const querySnapshot = await getDocs(q);

      const propertyList: Property[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        propertyList.push({
          id: doc.id,
          ...data,
          image: data.image,
        });
      });

      setProperties(propertyList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = async (propertyId: string) => {
    try {
      await deleteDoc(doc(db, "properties", propertyId));
      setProperties(properties.filter(p => p.id !== propertyId));
      setDeleteConfirm(null);
    } catch (error) {
      console.log(error);
      alert("Failed to delete property");
    }
  };

  const updateAvailability = async (propertyId: string, availabilityStatus: "available" | "reserved" | "sold") => {
    setUpdatingAvailability(propertyId);
    try {
      await updateDoc(doc(db, "properties", propertyId), { availabilityStatus, availabilityUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setProperties((current) => current.map((property) => property.id === propertyId ? { ...property, availabilityStatus } : property));
    } catch (error) {
      console.error("Unable to update property availability:", error);
      window.alert("The property availability could not be updated.");
    } finally {
      setUpdatingAvailability(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {sidebarOpen && <button type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] lg:hidden" />}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-300 lg:hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`} aria-hidden={!sidebarOpen}>
        <div className="flex items-center justify-between border-b border-slate-200 p-6">
          <div><p className="font-semibold text-slate-900">LiBot Broker</p><p className="text-xs text-slate-500">Property management</p></div>
          <button type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><X size={21} /></button>
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto p-5">
          <MobileNavLink href="/broker" icon={LayoutDashboard} label="Dashboard" onClick={() => setSidebarOpen(false)} />
          <MobileNavLink href="/broker/create-tour" icon={UploadCloud} label="Create Virtual Tour" onClick={() => setSidebarOpen(false)} />
          <MobileNavLink href="/broker/properties" icon={Home} label="My Properties" active onClick={() => setSidebarOpen(false)} />
          <MobileNavLink href="/broker/virtual-tours" icon={Images} label="Manage Tours" onClick={() => setSidebarOpen(false)} />
          <MobileNavLink href="/broker/profile" icon={UserRound} label="Profile" onClick={() => setSidebarOpen(false)} />
          <MobileNavLink href="/broker/negotiations" icon={MessageSquare} label="Negotiations" onClick={() => setSidebarOpen(false)} />
        </nav>
        <div className="border-t border-slate-200 p-5"><MobileNavLink href="/broker/settings" icon={Settings} label="Settings" onClick={() => setSidebarOpen(false)} /></div>
      </aside>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg p-2 text-slate-700 transition-colors hover:bg-slate-100 hover:text-blue-600 lg:hidden"
            >
              {sidebarOpen ? (
                <X size={24} />
              ) : (
                <Menu size={24} />
              )}
            </button>
            <div>
              <h1 className="text-2xl font-light text-slate-900">My Properties</h1>
              <p className="text-sm text-slate-500">Manage your real estate listings</p>
            </div>
          </div>

          <NotificationCenter audience="broker" />
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 lg:p-10">
        {/* Add New Property Button */}
        <div className="mb-8">
          <Link
            href="/broker/create-property"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-lg hover:shadow-xl"
          >
            <Plus size={20} />
            <span>Add New Property</span>
          </Link>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse"
              >
                <div className="h-40 bg-slate-200" />
                <div className="p-6 space-y-4">
                  <div className="h-4 bg-slate-200 rounded w-2/3" />
                  <div className="h-4 bg-slate-200 rounded w-1/2" />
                  <div className="h-8 bg-slate-200 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Results Count */}
            <div className="mb-8">
              <p className="text-sm text-slate-600">
                You have <span className="font-semibold text-slate-900">{properties.length}</span> {properties.length === 1 ? "property" : "properties"}
              </p>
            </div>

            {/* Properties Grid */}
            {properties.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {properties.map((property) => (
                  <div
                    key={property.id}
                    className="relative bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-slate-300 transition-all group"
                  >
                    {/* Property cover: first uploaded gallery image */}
                    <div className="relative h-40 bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center overflow-hidden">
                      {property.image ? (
                        <Image
                          src={property.image}
                          alt={`${property.title || "Property"} cover`}
                          fill
                          sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                          className="object-cover"
                        />
                      ) : (
                        <Home size={48} className="text-slate-400" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-6">
                      <h3 className="font-semibold text-slate-900 text-lg mb-3 line-clamp-2 group-hover:text-blue-600 transition-colors">
                        {property.title || "Unnamed Property"}
                      </h3>

                      {/* Details */}
                      {property.location && (
                        <div className="flex items-start gap-2 mb-3">
                          <MapPin size={16} className="text-slate-400 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-slate-600">{property.location}</p>
                        </div>
                      )}

                      {property.price && (
                        <div className="flex items-center gap-2 mb-4">
                          <PhilippinePeso size={18} className="text-slate-400" />
                          <p className="text-lg font-semibold text-slate-900">{Number(property.price).toLocaleString("en-PH")}</p>
                        </div>
                      )}

                      {property.description && (
                        <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                          {property.description}
                        </p>
                      )}

                      <label className="mb-4 block text-xs font-semibold uppercase tracking-wider text-slate-500">Availability<select value={property.availabilityStatus ?? "available"} disabled={updatingAvailability === property.id} onChange={(event) => void updateAvailability(property.id, event.target.value as "available" | "reserved" | "sold")} className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold capitalize text-slate-700 outline-none focus:border-blue-400 disabled:opacity-50"><option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option></select></label>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-4 border-t border-slate-200">
                        <Link
                          href={`/broker/properties/${property.id}/edit`}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium"
                        >
                          <Edit size={16} />
                          <span>Edit</span>
                        </Link>
                        <button
                          onClick={() => setDeleteConfirm(property.id)}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium"
                        >
                          <Trash2 size={16} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Delete Confirmation */}
                    {deleteConfirm === property.id && (
                      <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center p-4">
                        <div className="bg-white rounded-xl p-6 max-w-sm">
                          <p className="font-semibold text-slate-900 mb-4">
                            Are you sure you want to delete this property?
                          </p>
                          <div className="flex gap-3">
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="flex-1 px-4 py-2 bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors font-medium"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDelete(property.id)}
                              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <Home size={32} className="text-slate-400" />
                </div>
                <p className="text-slate-900 text-lg font-medium mb-2">No properties yet</p>
                <p className="text-slate-500 text-sm mb-6">Start by creating your first property listing</p>
                <Link
                  href="/broker/create-property"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                >
                  <Plus size={20} />
                  <span>Create Property</span>
                </Link>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function MobileNavLink({ href, icon: Icon, label, active = false, onClick }: { href: string; icon: React.ComponentType<{ size?: number }>; label: string; active?: boolean; onClick: () => void }) {
  return <Link href={href} onClick={onClick} className={`flex items-center gap-3 rounded-xl px-4 py-3 font-medium transition-colors ${active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}><Icon size={20} /><span>{label}</span></Link>;
}
