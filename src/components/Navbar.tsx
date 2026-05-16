import Image from "next/image";
import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="bg-[#1a1a1a] border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="LiBot Logo"
            width={40}
            height={40}
            className="w-10 h-10"
          />
          <span className="text-xl font-bold">LiBot</span>
        </Link>
        
        <div className="flex gap-4">
          <Link href="/login" className="hover:text-gray-300 transition">
            Login
          </Link>
          <Link href="/register" className="hover:text-gray-300 transition">
            Register
          </Link>
        </div>
      </div>
    </nav>
  );
}
