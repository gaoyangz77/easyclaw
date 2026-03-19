import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../providers/AuthProvider.js";
import { AuthModal } from "./modals/AuthModal.js";
import { UserPopover } from "./UserPopover.js";
import { UserPlusIcon } from "./icons.js";
import { getUserInitial } from "../lib/user-manager.js";

interface UserAvatarButtonProps {
  onNavigate: (path: string) => void;
}

export function UserAvatarButton({ onNavigate }: UserAvatarButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  function handleClick() {
    if (user) {
      setPopoverOpen((v) => !v);
    } else {
      setAuthModalOpen(true);
    }
  }

  const initial = user ? getUserInitial(user) : "";

  return (
    <div className="user-avatar-wrapper">
      <button
        className={`user-avatar-btn${user ? " user-avatar-btn-active" : ""}`}
        onClick={handleClick}
        title={user ? user.email : t("auth.login")}
      >
        {user ? <span className="user-avatar-circle">{initial}</span> : <UserPlusIcon />}
      </button>
      <UserPopover
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        onNavigate={onNavigate}
      />
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}
