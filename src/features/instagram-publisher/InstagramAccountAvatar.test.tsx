import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InstagramAccountAvatar } from "./InstagramAccountAvatar";
afterEach(cleanup);
it("shows the profile photo, falls back on load failure and retries a refreshed URL", () => {
  const view = render(<InstagramAccountAvatar username="alfa" url="https://cdn.example.com/a.jpg" />);
  fireEvent.error(screen.getByRole("img", { name: "Foto de perfil de @alfa" }));
  expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.getByText("AL")).toBeInTheDocument();
  view.rerender(<InstagramAccountAvatar username="alfa" url="https://cdn.example.com/new.jpg" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example.com/new.jpg");
});
it("never uses an unsafe or missing URL as an image source", () => {
  render(<InstagramAccountAvatar username="alfa" name="Principal" url="javascript:alert(1)" />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.getByText("PR")).toBeInTheDocument();
});
