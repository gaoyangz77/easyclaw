import { useState, useRef, useEffect } from "react";
import { useCreditsAuth } from "../hooks/useCreditsAuth.js";
import { CreditsAuthModal } from "./CreditsAuthModal.js";
import { UserPlusIcon } from "./icons.js";

export function UserAvatarButton() {
  const { me, logout } = useCreditsAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  if (me) {
    const initial = me.email?.[0]?.toUpperCase() ?? "?";
    return (
      <div className="user-avatar-wrapper" ref={wrapperRef}>
        <button
          className="user-avatar-btn user-avatar-btn-active"
          onClick={() => setShowMenu((v) => !v)}
          title={me.email ?? undefined}
        >
          <span className="user-avatar-circle">{initial}</span>
        </button>
        {showMenu && (
          <div className="user-avatar-menu">
            <div className="user-avatar-menu-email">{me.email}</div>
            <button
              className="user-avatar-menu-logout"
              onClick={() => { logout(); setShowMenu(false); }}
            >
              退出登录
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="user-avatar-wrapper">
      <button
        className="user-avatar-btn"
        onClick={() => setModalOpen(true)}
        title="登录"
      >
        <UserPlusIcon />
      </button>
      <CreditsAuthModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
