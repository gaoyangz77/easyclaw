import { gql } from "@apollo/client/core";

export const SURFACES_QUERY = gql`
  query Surfaces {
    surfaces {
      id
      userId
      name
      description
      allowedToolIds
      createdAt
      updatedAt
    }
  }
`;

export const CREATE_SURFACE_MUTATION = gql`
  mutation CreateSurface($input: CreateSurfaceInput!) {
    createSurface(input: $input) {
      id
      userId
      name
      description
      allowedToolIds
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_SURFACE_MUTATION = gql`
  mutation UpdateSurface($id: ID!, $input: UpdateSurfaceInput!) {
    updateSurface(id: $id, input: $input) {
      id
      userId
      name
      description
      allowedToolIds
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_SURFACE_MUTATION = gql`
  mutation DeleteSurface($id: ID!) {
    deleteSurface(id: $id)
  }
`;
