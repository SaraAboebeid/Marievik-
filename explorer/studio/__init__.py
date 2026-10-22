"""Floor studio: furnished layouts, capacity, escape routes and ten-year costs for a building's floors.

A MOCK-UP on B01's traced plans (data/plans/marievik/B01.json) until the surveyed plans arrive. Prices,
carbon and running costs live in data/studio/costs.json, the rent roll in data/projects/<project>/leases.json.

    layouts   B01's geometry, room types and the layouts (each a function of its movable-wall parameters)
    engine    one floor + one layout -> rooms, doors, walls, furniture, walking grid, escape routes, figures
    money     what a change costs, and running costs year by year
    tenancy   who rents which suite
    capacity  the wall positions that fit the most people while every check still passes
"""
