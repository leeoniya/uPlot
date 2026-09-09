export async function renderDemo(groups) {
  const plots = [];

  for (const group of groups) {
    for (let i = 0; i < (group.breakBefore ?? 0); i++)
      document.body.appendChild(document.createElement('br'));

    if (group.name) {
      const heading = document.createElement('h2');
      heading.textContent = group.name;
      document.body.appendChild(heading);
    }

    for (const step of group.steps) {
      for (let i = 0; i < (step.breakBefore ?? 0); i++)
        document.body.appendChild(document.createElement('br'));

      plots.push(await step.render());

      for (let i = 0; i < (step.breakAfter ?? 0); i++)
        document.body.appendChild(document.createElement('br'));
    }

    for (let i = 0; i < (group.breakAfter ?? 0); i++)
      document.body.appendChild(document.createElement('br'));
  }

  return plots;
}
