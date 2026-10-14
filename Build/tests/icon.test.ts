import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Icon } from "../src/ui/components/shared/Icon";

jest.mock("react-i18next", () => {
  const t = (key: string): string => key;
  return { useTranslation: () => ({ t }) };
});

jest.mock("../src/ui/theming/hooks", () => ({
  useIconSet: () => ({
    currentIconSet: { id: "lucide" },
    resolveIcon: (name: string): Promise<unknown> =>
      name === "play"
        ? new Promise(() => {})
        : Promise.resolve({
            type: "svg-inline",
            content: '<svg data-testid="pause-icon"></svg>',
          }),
  }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe("Icon", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not latch a blank button when the name flickers back to a cached icon", async () => {
    await act(async () => {
      root.render(createElement(Icon, { name: "pause" }));
    });
    expect(container.querySelector('[data-testid="pause-icon"]')).not.toBeNull();

    await act(async () => {
      root.render(createElement(Icon, { name: "play" }));
    });

    await act(async () => {
      root.render(createElement(Icon, { name: "pause" }));
    });
    expect(container.querySelector('[data-testid="pause-icon"]')).not.toBeNull();
  });
});
